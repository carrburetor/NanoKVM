import { useEffect, useRef, useState } from 'react';
import { Checkbox, Select, Switch } from 'antd';
import { useTranslation } from 'react-i18next';

import * as api from '@/api/vm.ts';
import { JigglerSchedule, setMouseJiggler } from '@/api/vm.ts';

// Go time.Weekday: 0=Sun, 1=Mon … 6=Sat
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DEFAULT_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const DEFAULT_START = '08:00';
const DEFAULT_END = '17:00';

export const MouseJiggler = () => {
  const { t } = useTranslation();

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState('relative');
  const [isLoading, setIsLoading] = useState(false);
  const [schedule, setSchedule] = useState<JigglerSchedule | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    getMouseJiggler();
  }, []);

  const options = [
    { value: 'disable', label: t('settings.device.mouseJiggler.disable') },
    { value: 'relative', label: t('settings.device.mouseJiggler.relative') },
    { value: 'absolute', label: t('settings.device.mouseJiggler.absolute') }
  ];

  function getMouseJiggler() {
    setIsLoading(true);

    api
      .getMouseJiggler()
      .then((rsp) => {
        if (rsp.code !== 0) {
          console.log(rsp.msg);
          return;
        }

        setEnabled(rsp.data.enabled);
        setMode(rsp.data.mode);
        if (rsp.data.schedule) {
          setSchedule(rsp.data.schedule);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }

  function enable() {
    if (isLoading) return;
    setIsLoading(true);

    api
      .setMouseJiggler(true, mode)
      .then((rsp) => {
        if (rsp.code !== 0) {
          console.log(rsp.msg);
          return;
        }

        setEnabled(true);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }

  function updateMode(value: string) {
    if (isLoading) return;
    setIsLoading(true);

    const _enabled = value !== 'disable';
    const _mode = value === 'disable' ? 'relative' : value;

    setMouseJiggler(_enabled, _mode, schedule ?? undefined)
      .then((rsp) => {
        if (rsp.code !== 0) {
          console.log(rsp.msg);
          return;
        }

        setEnabled(_enabled);
        setMode(_mode);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }

  function saveSchedule(next: JigglerSchedule | null) {
    setSchedule(next);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setMouseJiggler(enabled, mode, next ?? { days: [], startTime: '', endTime: '' });
    }, 500);
  }

  function toggleDay(day: number, checked: boolean) {
    const cur = schedule ?? { days: [...DEFAULT_DAYS], startTime: DEFAULT_START, endTime: DEFAULT_END };
    let days = checked ? [...cur.days, day] : cur.days.filter((d) => d !== day);
    days.sort((a, b) => a - b);
    if (days.length === 0) {
      saveSchedule(null);
    } else {
      saveSchedule({ ...cur, days });
    }
  }

  function updateTime(field: 'startTime' | 'endTime', value: string) {
    const cur = schedule ?? { days: [...DEFAULT_DAYS], startTime: DEFAULT_START, endTime: DEFAULT_END };
    saveSchedule({ ...cur, [field]: value });
  }

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col space-y-1">
          <span>{t('settings.device.mouseJiggler.title')}</span>
          <span className="text-xs text-neutral-500">
            {t('settings.device.mouseJiggler.description')}
          </span>
        </div>

        {enabled ? (
          <Select
            style={{ width: 150 }}
            value={mode}
            options={options}
            loading={isLoading}
            onChange={updateMode}
          />
        ) : (
          <Switch checked={enabled} loading={isLoading} onChange={enable} />
        )}
      </div>

      {enabled && (
        <div className="flex flex-col space-y-2 rounded border border-neutral-700 p-3">
          <span className="text-xs text-neutral-400">
            {t('settings.device.mouseJiggler.schedule')}
          </span>
          <span className="text-xs text-neutral-500">
            {t('settings.device.mouseJiggler.scheduleDescription')}
          </span>

          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {DAY_KEYS.map((key, i) => (
              <Checkbox
                key={i}
                checked={schedule ? schedule.days.includes(i) : false}
                onChange={(e) => toggleDay(i, e.target.checked)}
              >
                <span className="text-xs">
                  {t(`settings.device.mouseJiggler.${key}`)}
                </span>
              </Checkbox>
            ))}
          </div>

          {schedule && schedule.days.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <label>
                {t('settings.device.mouseJiggler.start')}
                <input
                  type="time"
                  className="ml-1 rounded border border-neutral-600 bg-neutral-800 px-1 py-0.5 text-xs text-neutral-200"
                  value={schedule.startTime}
                  onChange={(e) => updateTime('startTime', e.target.value)}
                />
              </label>
              <label>
                {t('settings.device.mouseJiggler.end')}
                <input
                  type="time"
                  className="ml-1 rounded border border-neutral-600 bg-neutral-800 px-1 py-0.5 text-xs text-neutral-200"
                  value={schedule.endTime}
                  onChange={(e) => updateTime('endTime', e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
