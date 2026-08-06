import { useState } from 'react';
import { Copy, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { NewsItem, Client } from '@/types';
import { draftNewsMessage } from '@/lib/claudeClient';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/hooks/use-toast';
import { AiBadge } from '@/components/ui/AiBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface NewsDraftModalProps {
  newsItem: NewsItem;
  clientId: string;
  clients: Client[];
  onClose: () => void;
}

export function NewsDraftModal({ newsItem, clientId, clients, onClose }: NewsDraftModalProps) {
  const navigate = useNavigate();
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const client = clients.find((c) => c.id === clientId);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!client) return;
    setLoading(true);
    setError('');
    setDraft('');
    try {
      const newsContext = `Headline: ${newsItem.headline}\nSource: ${newsItem.source}\nSummary: ${newsItem.summary}`;
      const clientContext = `Name: ${client.name}, Age: ${client.age}, Risk Profile: ${client.riskProfile}, AUM: $${(client.aum / 1_000_000).toFixed(2)}M, Key Concerns: ${client.keyConcerns}, Communication Preferences: ${client.communicationPreferences}`;
      const result = await draftNewsMessage(newsContext, clientContext);
      setDraft(result);
    } catch (err) {
      setError('Unable to generate message right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      toast({ title: 'Copied to clipboard', description: 'Message ready to paste.' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Copy failed', description: 'Please select and copy manually.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Draft Client Message</DialogTitle>
          <DialogDescription className="space-y-1 pt-1">
            <span className="block font-medium text-gray-800">{newsItem.headline}</span>
            {client && (
              <span className="block text-xs text-gray-500">
                For: <span className="font-medium text-gray-700">{client.name}</span>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!apiKey && (
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-2">
                <span>Add your Claude API key in Settings to enable AI features.</span>
                <button onClick={() => { onClose(); navigate('/settings'); }} className="text-xs underline flex-shrink-0">
                  Go to Settings
                </button>
              </AlertDescription>
            </Alert>
          )}
          {apiKey && !draft && !loading && !error && (
            <Button onClick={handleGenerate} className="w-full" disabled={!client}>
              Generate Draft
            </Button>
          )}
          {!apiKey && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {draft && !loading && (
            <>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                className="resize-none text-sm leading-relaxed"
              />
              <div className="flex items-center justify-between gap-2">
                <AiBadge />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleGenerate}>
                    Regenerate
                  </Button>
                  <Button size="sm" onClick={handleCopy}>
                    {copied ? (
                      <>
                        <CheckCheck size={14} className="mr-1.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy size={14} className="mr-1.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleGenerate}>
                Try Again
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

          {apiKey && !draft && !loading && !error && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
