import { useState } from 'react';
import type { Sheet, Units } from '../model';
import { parseScale, SCALE_PRESETS } from '../units';
import type { ScaleCheck } from '../scaleCheck';
import { Icon } from './Icons';

interface Props {
  sheet: Sheet;
  /** Which system to show first; both are always available. */
  units: Units;
  onPick: (label: string, metersPerPoint: number) => void;
  onCalibrate: () => void;
  onClear: () => void;
  /** The sheet's dimension strings read against its linework: 'reading' while that runs. */
  check: ScaleCheck | null | 'reading';
}

const systemOf = (label: string): Units => (/^\s*1\s*:/.test(label) ? 'metric' : 'imperial');

/**
 * Sets a sheet's drawing scale: metric ratios or imperial architectural and
 * engineering scales, the scales printed on the sheet, any other scale typed in,
 * or calibration from a known dimension.
 */
export function ScalePicker({ sheet, units, onPick, onCalibrate, onClear, check }: Props) {
  const [system, setSystem] = useState<Units>(sheet.scaleLabel && parseScale(sheet.scaleLabel) ? systemOf(sheet.scaleLabel) : units);
  const [custom, setCustom] = useState('');
  const customMpp = custom.trim() ? parseScale(custom) : null;
  const current = sheet.scaleLabel;

  const choice = (label: string) => (
    <button key={label} className={`scale-choice ${current === label ? 'current' : ''}`} onClick={() => onPick(label, parseScale(label)!)}>
      <span>{label}</span>
      {current === label && <Icon name="check" size={14} />}
    </button>
  );

  return (
    <div className="scale-picker">
      <div className="pop-head">
        <div>
          <div className="pop-title">Drawing scale</div>
          <div className="pop-sub">
            {sheet.name} ·{' '}
            {!sheet.metersPerPoint
              ? 'not set'
              : sheet.scaleSource === 'detected'
                ? `${current}, read from the sheet. Check it against a dimension.`
                : sheet.scaleSource === 'verified'
                  ? `${current}, read from the sheet and checked against its dimensions`
                : sheet.scaleSource === 'calibrated'
                  ? `calibrated (${current})`
                  : current}
          </div>
        </div>
      </div>

      <div className="scale-verify">
        {check === 'reading' ? (
          <span className="muted">Checking the scale against the sheet’s dimensions…</span>
        ) : !check ? (
          <span className="muted">Not enough dimension strings on this sheet to check the scale.</span>
        ) : sheet.metersPerPoint && Math.abs(check.metersPerPoint / sheet.metersPerPoint - 1) < 0.02 ? (
          <span className="check-ok">
            <Icon name="check" size={14} /> Matches {check.agree} dimensions on the sheet.
          </span>
        ) : check.agree >= 5 ? (
          <span className="check-warn">
            {sheet.metersPerPoint ? 'Dimensions on this sheet read as' : 'Dimensions read as'} <b>{check.label}</b> ({check.agree} of {check.read}).{' '}
            <button className="link-button" onClick={() => onPick(check.label, check.metersPerPoint)}>
              Use {check.label}
            </button>
          </span>
        ) : (
          <span className="muted">
            A few dimensions read as {check.label}; too few to be sure.
          </span>
        )}
      </div>

      {sheet.scaleHints.length > 0 && (
        <div className="pop-section">
          <div className="pop-label">Printed on this sheet</div>
          <div className="scale-grid">{sheet.scaleHints.filter((h) => parseScale(h)).map(choice)}</div>
        </div>
      )}

      <div className="pop-section">
        <div className="segmented small" role="tablist" aria-label="Scale system">
          {(['metric', 'imperial'] as const).map((u) => (
            <button key={u} role="tab" aria-selected={system === u} className={system === u ? 'on' : ''} onClick={() => setSystem(u)}>
              {u === 'metric' ? 'Metric' : 'Imperial'}
            </button>
          ))}
        </div>
        <div className="scale-grid">{SCALE_PRESETS[system].map(choice)}</div>
      </div>

      <form
        className="pop-section custom-scale"
        onSubmit={(e) => {
          e.preventDefault();
          if (customMpp) onPick(custom.trim(), customMpp);
        }}
      >
        <label className="pop-label" htmlFor="custom-scale">
          Another scale
        </label>
        <div className="input-row">
          <input
            id="custom-scale"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={system === 'metric' ? '1:150' : '3/32" = 1\'-0"'}
            autoComplete="off"
          />
          <button type="submit" className="primary" disabled={!customMpp}>
            Set
          </button>
        </div>
        {custom.trim() && !customMpp && <div className="field-hint">Use 1:150, 1/4" = 1'-0" or 1" = 20'.</div>}
      </form>

      <div className="pop-actions">
        <button onClick={onCalibrate}>
          <Icon name="calibrate" size={16} /> Calibrate from a dimension
        </button>
        {sheet.metersPerPoint && (
          <button className="quiet danger" onClick={onClear}>
            Clear scale
          </button>
        )}
      </div>
    </div>
  );
}
