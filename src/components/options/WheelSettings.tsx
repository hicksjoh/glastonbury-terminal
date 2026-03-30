'use client';

import { useState } from 'react';

interface WheelConfig {
  putDelta: number;
  callDelta: number;
  targetDTE: number;
  profitTarget: number;
}

interface WheelSettingsProps {
  config?: WheelConfig;
  onChange?: (config: WheelConfig) => void;
}

const DEFAULT_CONFIG: WheelConfig = {
  putDelta: 0.30,
  callDelta: 0.30,
  targetDTE: 35,
  profitTarget: 50,
};

export default function WheelSettings({ config: initial, onChange }: WheelSettingsProps) {
  const [config, setConfig] = useState<WheelConfig>(initial || DEFAULT_CONFIG);

  function update(field: keyof WheelConfig, value: number) {
    const updated = { ...config, [field]: value };
    setConfig(updated);
    onChange?.(updated);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SliderSetting
        label="Put Delta Target"
        value={config.putDelta}
        min={0.15}
        max={0.40}
        step={0.05}
        format={v => v.toFixed(2)}
        sublabel={`≈${Math.round(config.putDelta * 100)}% chance of assignment`}
        onChange={v => update('putDelta', v)}
      />
      <SliderSetting
        label="Call Delta Target"
        value={config.callDelta}
        min={0.15}
        max={0.40}
        step={0.05}
        format={v => v.toFixed(2)}
        sublabel={`≈${Math.round(config.callDelta * 100)}% chance of being called`}
        onChange={v => update('callDelta', v)}
      />
      <SliderSetting
        label="Target DTE"
        value={config.targetDTE}
        min={14}
        max={60}
        step={1}
        format={v => `${v} days`}
        sublabel="Days to expiration when opening"
        onChange={v => update('targetDTE', v)}
      />
      <SliderSetting
        label="Profit Target to Roll"
        value={config.profitTarget}
        min={25}
        max={80}
        step={5}
        format={v => `${v}%`}
        sublabel="Close at this % profit, open new position"
        onChange={v => update('profitTarget', v)}
      />
    </div>
  );
}

function SliderSetting({
  label, value, min, max, step, format, sublabel, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  sublabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#c8c8d0', fontWeight: 600 }}>{label}</span>
        <span style={{
          fontSize: 14, fontWeight: 700, color: '#c9a84c',
          fontFamily: "'JetBrains Mono', monospace",
        }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#c9a84c', height: 4 }}
      />
      <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{sublabel}</div>
    </div>
  );
}
