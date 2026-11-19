package jiggler

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"NanoKVM-Server/proto"
	"NanoKVM-Server/service/controlmode"
	"NanoKVM-Server/service/hid"
	"NanoKVM-Server/service/inputcontrol"
)

const (
	ConfigFile         = "/etc/kvm/mouse-jiggler"
	ScheduleConfigFile = "/etc/kvm/mouse-jiggler-schedule"
	Interval           = 15 * time.Second
)

var (
	jiggler Jiggler
	once    sync.Once
)

type Jiggler struct {
	mutex       sync.Mutex
	enabled     bool
	running     bool
	mode        string
	lastUpdated time.Time
	schedule    *proto.JigglerSchedule
}

func GetJiggler() *Jiggler {
	once.Do(func() {
		jiggler = Jiggler{
			mutex:       sync.Mutex{},
			enabled:     false,
			running:     false,
			mode:        "relative",
			lastUpdated: time.Now(),
		}

		content, err := os.ReadFile(ConfigFile)
		if err != nil {
			return
		}

		mode := strings.ReplaceAll(string(content), "\n", "")
		if mode != "" {
			jiggler.mode = mode
		}

		if schedData, err := os.ReadFile(ScheduleConfigFile); err == nil {
			var sched proto.JigglerSchedule
			if json.Unmarshal(schedData, &sched) == nil && len(sched.Days) > 0 {
				jiggler.schedule = &sched
			}
		}

		jiggler.enabled = true
	})

	return &jiggler
}

func (j *Jiggler) Enable(mode string) error {
	err := os.WriteFile(ConfigFile, []byte(mode), 0644)
	if err != nil {
		return err
	}

	j.enabled = true
	j.mode = mode
	j.Run()

	return nil
}

func (j *Jiggler) Disable() error {
	if err := os.Remove(ConfigFile); err != nil {
		return err
	}

	j.enabled = false
	j.mode = "relative"

	return nil
}

func (j *Jiggler) Run() {
	if !j.enabled || j.running {
		return
	}

	j.mutex.Lock()
	j.running = true
	j.mutex.Unlock()

	j.Update()

	go func() {
		ticker := time.NewTicker(Interval)
		defer ticker.Stop()

		for range ticker.C {
			if !j.enabled {
				j.running = false
				return
			}

			if time.Since(j.lastUpdated) > Interval {
				if j.isScheduleActive() {
					move(j.mode)
				}
				j.Update()
			}
		}
	}()
}

func (j *Jiggler) Update() {
	if j.running {
		j.lastUpdated = time.Now()
	}
}

func (j *Jiggler) IsEnabled() bool {
	return j.enabled
}

func (j *Jiggler) GetMode() string {
	return j.mode
}

func (j *Jiggler) GetSchedule() *proto.JigglerSchedule {
	j.mutex.Lock()
	defer j.mutex.Unlock()
	return j.schedule
}

func (j *Jiggler) SetSchedule(s *proto.JigglerSchedule) error {
	j.mutex.Lock()
	defer j.mutex.Unlock()

	if s == nil || len(s.Days) == 0 {
		j.schedule = nil
		_ = os.Remove(ScheduleConfigFile)
		return nil
	}

	data, err := json.Marshal(s)
	if err != nil {
		return err
	}

	if err := os.WriteFile(ScheduleConfigFile, data, 0644); err != nil {
		return err
	}

	j.schedule = s
	return nil
}

// isScheduleActive returns true when the jiggler should fire right now.
// No schedule means always active (backwards-compatible).
func (j *Jiggler) isScheduleActive() bool {
	j.mutex.Lock()
	s := j.schedule
	j.mutex.Unlock()
	return scheduleActiveAt(s, time.Now())
}

// scheduleActiveAt is the pure logic, testable with any time.
func scheduleActiveAt(s *proto.JigglerSchedule, now time.Time) bool {
	if s == nil || len(s.Days) == 0 {
		return true
	}

	wd := int(now.Weekday())
	dayMatch := false
	for _, d := range s.Days {
		if d == wd {
			dayMatch = true
			break
		}
	}
	if !dayMatch {
		return false
	}

	current := fmt.Sprintf("%02d:%02d", now.Hour(), now.Minute())
	return current >= s.StartTime && current < s.EndTime
}

func move(mode string) {
	_, releaseMode, err := controlmode.GetManager().AcquireStable()
	if err != nil {
		return
	}
	defer releaseMode()

	ctx, release, err := inputcontrol.GetCoordinator().BeginBackground(context.Background())
	if err != nil {
		return
	}
	defer release()

	h := hid.GetHid()

	if mode == "absolute" {
		if err := h.WriteAbsoluteMouseReport([]byte{0x00, 0x00, 0x3f, 0x00, 0x3f, 0x00}); err != nil {
			return
		}
		defer func() {
			_ = h.WriteAbsoluteMouseReport([]byte{0x00, 0xff, 0x3f, 0xff, 0x3f, 0x00})
		}()
		_ = waitMove(ctx, 100*time.Millisecond)
	} else {
		if err := h.WriteRelativeMouseReport([]byte{0x00, 0xa, 0xa, 0x00}); err != nil {
			return
		}
		defer func() {
			_ = h.WriteRelativeMouseReport([]byte{0x00, 0xf6, 0xf6, 0x00})
		}()
		_ = waitMove(ctx, 100*time.Millisecond)
	}
}

func waitMove(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
