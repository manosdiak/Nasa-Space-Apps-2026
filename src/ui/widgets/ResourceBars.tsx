// The six resource bars (Mass, Power, Budget, Data, Comms, Time/Fuel) with a
// green/yellow/red fill and a one-sentence tip.
import type { ResourceKey, ResourceState } from '../../../shared/types';
import { STATUS_COLOR, money, n } from './common';
import { BAR_HELP, BAR_ICON, BAR_LABEL, barFill, barStatus, barTip, barValue } from './tips';

const KEYS: ResourceKey[] = ['mass', 'power', 'budget', 'data', 'comms', 'time'];

export function ResourceBars({ res, sandbox = false, detail = false }: { res: ResourceState; sandbox?: boolean; detail?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {KEYS.map((k) => {
        const s = barStatus(k, res);
        const fill = sandbox && k === 'budget' ? 0.2 : barFill(k, res);
        const why = detail ? res.pillars[k].why[0] : undefined;
        return (
          <div key={k} title={BAR_HELP[k]}>
            <div className="flex items-center gap-1 text-[17px] leading-tight">
              <span className="w-6 text-center">{BAR_ICON[k]}</span>
              <span className="font-pixel text-[8px]" style={{ color: STATUS_COLOR[s] }}>{BAR_LABEL[k].toUpperCase()}</span>
              <span className="flex-1" />
              <span className="text-muted text-[15px] truncate">{barValue(k, res, n, money, sandbox)}</span>
            </div>
            <div className="relative h-[12px] bg-[#0a0f20] border-2 border-black mt-[2px]">
              <div className="absolute inset-y-0 left-0" style={{ width: `${Math.max(3, Math.min(100, fill * 100))}%`, background: STATUS_COLOR[s], backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,.2) 0 2px, transparent 2px 6px)' }} />
              {fill > 1 && <div className="absolute inset-y-0 right-0 w-[5px] bg-crit blink" />}
            </div>
            <div className="text-[15px] leading-tight mt-[2px]" style={{ color: s === 'ok' ? '#9aa6d0' : STATUS_COLOR[s] }}>{barTip(k, res)}</div>
            {why && s !== 'ok' && <div className="text-[14px] leading-tight text-muted">{why.split(/(?<=\.)\s/).slice(0, 2).join(' ')}</div>}
          </div>
        );
      })}
    </div>
  );
}
