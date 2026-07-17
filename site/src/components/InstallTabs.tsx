import { useState } from 'react';
import CodeBlock from './CodeBlock';

const tabs = [
  { id: 'win', label: 'Windows' },
  { id: 'npm', label: 'npm' },
  { id: 'build', label: 'Build from source' },
];

export default function InstallTabs() {
  const [active, setActive] = useState('win');

  return (
    <section id="install">
      <h2>install</h2>

      <div className="install-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab${active === t.id ? ' active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'win' && (
        <div className="tab-content active">
          <p>One-line install (run in PowerShell as Administrator):</p>
          <CodeBlock
            code={'powershell -ExecutionPolicy Bypass -c "irm https://caya8205-2.github.io/avpull/install.ps1 | iex"'}
            id="install-cmd"
          />
          <p>
            Or download from{' '}
            <a href="https://github.com/caya8205-2/avpull/releases/latest" target="_blank" rel="noopener">
              GitHub Releases
            </a>.
          </p>
        </div>
      )}

      {active === 'npm' && (
        <div className="tab-content active">
          <p>Install globally via npm:</p>
          <CodeBlock code="npm install -g avpull" id="npm-cmd" />
        </div>
      )}

      {active === 'build' && (
        <div className="tab-content active">
          <p>Clone the repository and build with Bun:</p>
          <CodeBlock
            code={`git clone https://github.com/caya8205-2/avpull.git
cd avpull
bun install
bun run build`}
            id="build-cmd"
          />
        </div>
      )}
    </section>
  );
}
