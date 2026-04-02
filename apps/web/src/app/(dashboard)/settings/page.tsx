'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  ShoppingCart,
  Megaphone,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
  Trash2,
  Globe,
} from 'lucide-react';

// Marketplace display info
const MARKETPLACES: Array<{ id: string; name: string; flag: string; region: string }> = [
  { id: 'ATVPDKIKX0DER', name: 'United States', flag: '🇺🇸', region: 'NA' },
  { id: 'A2EUQ1WTGCTBG2', name: 'Canada', flag: '🇨🇦', region: 'NA' },
  { id: 'A1AM78C64UM0Y8', name: 'Mexico', flag: '🇲🇽', region: 'NA' },
  { id: 'A2Q3Y263D00KWC', name: 'Brazil', flag: '🇧🇷', region: 'NA' },
  { id: 'A1F83G8C2ARO7P', name: 'United Kingdom', flag: '🇬🇧', region: 'EU' },
  { id: 'A1PA6795UKMFR9', name: 'Germany', flag: '🇩🇪', region: 'EU' },
  { id: 'A1RKKUPIHCS9HS', name: 'Spain', flag: '🇪🇸', region: 'EU' },
  { id: 'A13V1IB3VIYZZH', name: 'France', flag: '🇫🇷', region: 'EU' },
  { id: 'APJ6JRA9NG5V4',  name: 'Italy', flag: '🇮🇹', region: 'EU' },
  { id: 'A1805IZSGTT6HS', name: 'Netherlands', flag: '🇳🇱', region: 'EU' },
  { id: 'A1VC38T7YXB528', name: 'Japan', flag: '🇯🇵', region: 'FE' },
  { id: 'A39IBJ37TRP1C6', name: 'Australia', flag: '🇦🇺', region: 'FE' },
  { id: 'A19VAU5U5O7RUS', name: 'Singapore', flag: '🇸🇬', region: 'FE' },
];

function getMarketplaceName(id: string): string {
  const m = MARKETPLACES.find((m) => m.id === id);
  return m ? `${m.flag} ${m.name}` : id;
}

interface ProfileInfo {
  profile_name: string;
  api_type: string;
  marketplace_id: string;
  region?: string;
  created_at?: number;
}

interface ConnectionStatus {
  sp_api: { connected: boolean; profiles: ProfileInfo[] };
  ads_api: { connected: boolean; profiles: ProfileInfo[] };
}

function ProfileCard({
  profile,
  onDisconnect,
  disconnecting,
}: {
  profile: ProfileInfo;
  onDisconnect: (profileName: string, apiType: string) => void;
  disconnecting: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-medium">{getMarketplaceName(profile.marketplace_id)}</p>
          <p className="text-xs text-muted-foreground">
            {profile.profile_name !== 'default' && (
              <span className="mr-2 font-mono">{profile.profile_name}</span>
            )}
            {profile.marketplace_id}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant="secondary"
          className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
        >
          <Check className="mr-1 h-3 w-3" />
          Connected
        </Badge>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
              {disconnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove your {getMarketplaceName(profile.marketplace_id)}{' '}
                {profile.api_type === 'SP_API' ? 'Seller' : 'Ads'} account connection from Sellavant.
                You can reconnect at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onDisconnect(profile.profile_name, profile.api_type)}
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [spMarketplace, setSpMarketplace] = useState('ATVPDKIKX0DER');
  const [adsMarketplace, setAdsMarketplace] = useState('ATVPDKIKX0DER');
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/amazon/status');
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // Status check failed — show disconnected state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected === 'sp_api') {
      showToast('success', 'Amazon Seller account connected successfully!');
    } else if (connected === 'ads_api') {
      showToast('success', 'Amazon Ads account connected successfully!');
    } else if (error) {
      showToast('error', decodeURIComponent(error));
    }
  }, [searchParams, showToast]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleDisconnect(profileName: string, apiType: string) {
    const key = `${apiType}::${profileName}`;
    setDisconnecting(key);
    try {
      const res = await fetch(
        `/api/amazon/disconnect?apiType=${encodeURIComponent(apiType)}&profile=${encodeURIComponent(profileName)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        showToast('success', `Account disconnected successfully.`);
        await fetchStatus();
      } else {
        const body = await res.json();
        showToast('error', body.error || 'Failed to disconnect account.');
      }
    } catch {
      showToast('error', 'Failed to disconnect account.');
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-muted-foreground">
        Connect your Amazon accounts to enable AI-powered insights.
      </p>

      {/* Toast notification */}
      {toast && (
        <div
          className={`mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm ${
            toast.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
          }`}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      <div className="mt-8 space-y-6">
        {/* SP-API Connection Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-950">
                <ShoppingCart className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <CardTitle className="text-lg">Amazon Seller Account</CardTitle>
                <CardDescription>Selling Partner API (SP-API)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Allows Sellavant to access your product catalog, orders, inventory, and financial data
              to provide AI-powered insights and recommendations.
            </p>

            {/* Connected profiles */}
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : status?.sp_api.profiles && status.sp_api.profiles.length > 0 ? (
              <div className="space-y-2">
                {status.sp_api.profiles.map((profile) => (
                  <ProfileCard
                    key={`${profile.api_type}::${profile.profile_name}`}
                    profile={profile}
                    onDisconnect={handleDisconnect}
                    disconnecting={disconnecting === `${profile.api_type}::${profile.profile_name}`}
                  />
                ))}
              </div>
            ) : null}

            {/* Add account section */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={spMarketplace} onValueChange={setSpMarketplace}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Select marketplace" />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACES.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.flag} {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" asChild>
                <a href={`/api/amazon/sp-connect?marketplace=${spMarketplace}`}>
                  Connect Seller Account
                  <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Ads API Connection Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950">
                <Megaphone className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-lg">Amazon Ads Account</CardTitle>
                <CardDescription>Amazon Advertising API</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Allows Sellavant to manage your advertising campaigns, view spend and performance
              metrics, and optimize your ad strategy.
            </p>

            {/* Connected profiles */}
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : status?.ads_api.profiles && status.ads_api.profiles.length > 0 ? (
              <div className="space-y-2">
                {status.ads_api.profiles.map((profile) => (
                  <ProfileCard
                    key={`${profile.api_type}::${profile.profile_name}`}
                    profile={profile}
                    onDisconnect={handleDisconnect}
                    disconnecting={disconnecting === `${profile.api_type}::${profile.profile_name}`}
                  />
                ))}
              </div>
            ) : null}

            {/* Add account section */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={adsMarketplace} onValueChange={setAdsMarketplace}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Select marketplace" />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACES.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.flag} {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" asChild>
                <a href={`/api/amazon/ads-connect?marketplace=${adsMarketplace}`}>
                  Connect Ads Account
                  <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
