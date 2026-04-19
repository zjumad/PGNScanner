import { useState, useEffect } from 'react';
import type { ApiProvider } from '../services/visionApi';

interface ApiKeyDialogProps {
  onKeySet: (key: string, provider: ApiProvider) => void;
}

export default function ApiKeyDialog({ onKeySet }: ApiKeyDialogProps) {
  const [key, setKey] = useState('');
  const [provider, setProvider] = useState<ApiProvider>('gemini');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const storedKey = localStorage.getItem('vision_api_key');
    const storedProvider = localStorage.getItem('vision_api_provider') as ApiProvider | null;
    if (storedKey) {
      setKey(storedKey);
      const prov = storedProvider || 'gemini';
      setProvider(prov);
      setSaved(true);
      onKeySet(storedKey, prov);
    }
  }, [onKeySet]);

  const handleSave = () => {
    if (key.trim()) {
      localStorage.setItem('vision_api_key', key.trim());
      localStorage.setItem('vision_api_provider', provider);
      setSaved(true);
      onKeySet(key.trim(), provider);
    }
  };

  const handleClear = () => {
    localStorage.removeItem('vision_api_key');
    localStorage.removeItem('vision_api_provider');
    setKey('');
    setSaved(false);
  };

  if (saved) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="inline-flex items-center gap-1">
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          {provider === 'gemini' ? 'Gemini' : 'OpenAI'} key set
        </span>
        <button onClick={handleClear} className="text-xs text-gray-400 hover:text-red-500 underline">
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-600">
        API Key <span className="text-gray-400">(for move recognition)</span>
      </label>
      <div className="flex gap-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as ApiProvider)}
          className="px-2 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="gemini">Gemini (free tier)</option>
          <option value="openai">OpenAI</option>
        </select>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={provider === 'gemini' ? 'AIza...' : 'sk-...'}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
        <button
          onClick={handleSave}
          disabled={!key.trim()}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
      <p className="text-xs text-gray-400">
        {provider === 'gemini'
          ? 'Get a free API key from Google AI Studio (aistudio.google.com). Stored locally.'
          : 'Your key is stored locally and only sent to OpenAI.'}
      </p>
    </div>
  );
}
