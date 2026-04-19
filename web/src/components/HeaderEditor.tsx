import { useState } from 'react';
import type { GameHeader } from '../types';

interface HeaderEditorProps {
  header: GameHeader;
  onChange: (header: GameHeader) => void;
}

export default function HeaderEditor({ header, onChange }: HeaderEditorProps) {
  const [collapsed, setCollapsed] = useState(false);

  const update = (field: keyof GameHeader, value: string) => {
    onChange({ ...header, [field]: value });
  };

  const fields: { key: keyof GameHeader; label: string; placeholder: string }[] = [
    { key: 'event', label: 'Event', placeholder: 'Tournament name' },
    { key: 'date', label: 'Date', placeholder: 'YYYY.MM.DD' },
    { key: 'round', label: 'Round', placeholder: '1' },
    { key: 'white', label: 'White', placeholder: 'Player name' },
    { key: 'black', label: 'Black', placeholder: 'Player name' },
    { key: 'whiteElo', label: 'White Elo', placeholder: '' },
    { key: 'blackElo', label: 'Black Elo', placeholder: '' },
    { key: 'opening', label: 'Opening', placeholder: '' },
    { key: 'eco', label: 'ECO', placeholder: '' },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 text-left font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span>Game Info</span>
        <svg
          className={`w-5 h-5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 grid grid-cols-2 gap-3">
          {fields.map(({ key, label, placeholder }) => (
            <div key={key} className={key === 'event' ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
              <input
                type="text"
                value={header[key]}
                placeholder={placeholder}
                onChange={(e) => update(key, e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          ))}

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Result</label>
            <select
              value={header.result}
              onChange={(e) => update('result', e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="*">* (Unknown)</option>
              <option value="1-0">1-0 (White Won)</option>
              <option value="0-1">0-1 (Black Won)</option>
              <option value="1/2-1/2">½-½ (Draw)</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
