import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, CheckCircle, XCircle, KeyRound, User, Bell, Database } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { generateBrief } from '@/lib/claudeClient';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// ─── Settings Page ────────────────────────────────────────────────────────────

export function SettingsPage() {
  useEffect(() => { document.title = 'AdvisorIQ — Settings'; }, []);
  const faName = useAppStore((s) => s.faName);
  const claudeApiKey = useAppStore((s) => s.claudeApiKey);
  const setFaName = useAppStore((s) => s.setFaName);
  const setClaudeApiKey = useAppStore((s) => s.setClaudeApiKey);
  const resetToSeedData = useAppStore((s) => s.resetToSeedData);

  const apiSectionRef = useRef<HTMLDivElement>(null);
  const hasApiKey = !!claudeApiKey;

  function scrollToApiSection() {
    apiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your profile, API key, and preferences</p>
      </div>

      {!hasApiKey && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>No API key configured. AI features will not work until you add your Claude API key.</span>
            <button
              onClick={scrollToApiSection}
              className="text-xs underline underline-offset-2 flex-shrink-0 hover:no-underline"
            >
              Add key ↓
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Section 1 — Advisor Profile */}
      <ProfileSection faName={faName} setFaName={setFaName} />

      {/* Section 2 — API Configuration */}
      <div ref={apiSectionRef}>
        <ApiSection claudeApiKey={claudeApiKey} setClaudeApiKey={setClaudeApiKey} />
      </div>

      {/* Section 3 — Notification Preferences */}
      <NotificationSection />

      {/* Section 4 — Data Management */}
      <DataSection resetToSeedData={resetToSeedData} />
    </div>
  );
}

// ─── Section 1: Profile ───────────────────────────────────────────────────────

function ProfileSection({
  faName,
  setFaName,
}: {
  faName: string;
  setFaName: (n: string) => void;
}) {
  const [name, setName] = useState(faName);
  const [firmName, setFirmName] = useState(() => localStorage.getItem('firmName') ?? '');

  function handleSave() {
    setFaName(name.trim() || faName);
    localStorage.setItem('firmName', firmName.trim());
    toast({ title: 'Profile saved', description: 'Your advisor profile has been updated.' });
  }

  return (
    <SettingsCard icon={<User size={14} />} title="Advisor Profile">
      <div className="space-y-4">
        <FieldRow label="Your Name" description="Shown in greetings and briefs">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex Morgan"
          />
        </FieldRow>
        <FieldRow label="Firm Name" description="Optional — shown in client-facing outputs">
          <Input
            value={firmName}
            onChange={(e) => setFirmName(e.target.value)}
            placeholder="e.g. Morgan Wealth Advisors"
          />
        </FieldRow>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave}>Save Profile</Button>
        </div>
      </div>
    </SettingsCard>
  );
}

// ─── Section 2: API ───────────────────────────────────────────────────────────

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

function ApiSection({
  claudeApiKey,
  setClaudeApiKey,
}: {
  claudeApiKey: string;
  setClaudeApiKey: (k: string) => void;
}) {
  const [keyDraft, setKeyDraft] = useState(claudeApiKey);
  const [showKey, setShowKey] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');

  function handleSaveKey() {
    setClaudeApiKey(keyDraft.trim());
    toast({ title: 'API key saved', description: 'Your key is stored locally in this browser.' });
    setConnStatus('idle');
  }

  async function handleTestConnection() {
    if (!keyDraft.trim()) {
      toast({ title: 'No key entered', description: 'Enter your API key before testing.', variant: 'destructive' });
      return;
    }
    // Temporarily write the draft key so claudeClient can read it
    const previous = localStorage.getItem('claudeApiKey') ?? '';
    localStorage.setItem('claudeApiKey', keyDraft.trim());
    setConnStatus('testing');
    try {
      await generateBrief('Connection test — reply with one word: OK');
      setConnStatus('success');
    } catch {
      setConnStatus('error');
    } finally {
      // Restore previous persisted value unless the user has also saved
      if (claudeApiKey !== keyDraft.trim()) {
        localStorage.setItem('claudeApiKey', previous);
      }
    }
  }

  return (
    <SettingsCard icon={<KeyRound size={14} />} title="Claude API Key">
      <div className="space-y-4">
        <p className="text-xs text-gray-500 leading-relaxed">
          Your API key is stored locally in your browser and never sent to any server other than Anthropic's API.
        </p>

        <FieldRow label="API Key" description="Starts with sk-ant-…">
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={keyDraft}
              onChange={(e) => { setKeyDraft(e.target.value); setConnStatus('idle'); }}
              placeholder="sk-ant-api03-…"
              className="pr-10 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </FieldRow>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSaveKey}>Save Key</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestConnection}
            disabled={connStatus === 'testing'}
          >
            {connStatus === 'testing' ? 'Testing…' : 'Test Connection'}
          </Button>

          {connStatus === 'success' && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
              <CheckCircle size={13} /> Connected
            </span>
          )}
          {connStatus === 'error' && (
            <span className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
              <XCircle size={13} /> Invalid key or network error
            </span>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

// ─── Section 3: Notifications ─────────────────────────────────────────────────

const NOTIFICATION_PREFS = [
  {
    id: 'digest',
    label: 'Morning action queue digest',
    description: 'Daily summary of overdue items and today\'s meetings',
  },
  {
    id: 'birthdays',
    label: 'Client birthday reminders',
    description: 'Notified 3 days before a client\'s birthday',
  },
  {
    id: 'drift',
    label: 'Portfolio drift alerts',
    description: 'Alert when any client\'s allocation drifts more than 7% from target',
  },
  {
    id: 'meetings',
    label: 'Upcoming meeting reminders',
    description: 'Remind 24 hours before scheduled client meetings',
  },
];

function NotificationSection() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.id, true]))
  );

  return (
    <SettingsCard icon={<Bell size={14} />} title="Notification Preferences">
      <div className="space-y-5">
        {NOTIFICATION_PREFS.map((pref) => (
          <div key={pref.id} className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-800">{pref.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{pref.description}</div>
            </div>
            <Switch
              checked={prefs[pref.id]}
              onCheckedChange={(checked) =>
                setPrefs((p) => ({ ...p, [pref.id]: checked }))
              }
              className="flex-shrink-0 mt-0.5"
            />
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

// ─── Section 4: Data Management ───────────────────────────────────────────────

function DataSection({ resetToSeedData }: { resetToSeedData: () => void }) {
  function handleConfirmReset() {
    resetToSeedData();
    toast({ title: 'Data reset to demo state', description: 'All client data has been restored to the original demo data.' });
  }

  return (
    <SettingsCard icon={<Database size={14} />} title="Data Management">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-800 mb-1">Reset Application Data</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            This will reset all client data, meeting history, and saved notes to the original demo data. Your API key will not be affected.
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700">
              Reset to Demo Data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset all data?</AlertDialogTitle>
              <AlertDialogDescription>
                This will restore all client data, meeting history, and AI suggestions to the original demo state. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmReset}
                className="bg-red-600 hover:bg-red-700 text-white border-0"
              >
                Reset Data
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SettingsCard>
  );
}

// ─── Shared Primitives ────────────────────────────────────────────────────────

function SettingsCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className="text-gray-400">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <label className="text-sm font-medium text-gray-700">{label}</label>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}
