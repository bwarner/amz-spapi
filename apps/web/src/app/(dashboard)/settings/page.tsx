'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Globe,
  Layers3,
  Loader2,
  Megaphone,
  ShoppingCart,
  Sparkles,
  Trash2,
} from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MARKETPLACES: Array<{
  id: string;
  name: string;
  flag: string;
  region: string;
}> = [
  { id: 'ATVPDKIKX0DER', name: 'United States', flag: '🇺🇸', region: 'NA' },
  { id: 'A2EUQ1WTGCTBG2', name: 'Canada', flag: '🇨🇦', region: 'NA' },
  { id: 'A1AM78C64UM0Y8', name: 'Mexico', flag: '🇲🇽', region: 'NA' },
  { id: 'A2Q3Y263D00KWC', name: 'Brazil', flag: '🇧🇷', region: 'NA' },
  { id: 'A1F83G8C2ARO7P', name: 'United Kingdom', flag: '🇬🇧', region: 'EU' },
  { id: 'A1PA6795UKMFR9', name: 'Germany', flag: '🇩🇪', region: 'EU' },
  { id: 'A1RKKUPIHCS9HS', name: 'Spain', flag: '🇪🇸', region: 'EU' },
  { id: 'A13V1IB3VIYZZH', name: 'France', flag: '🇫🇷', region: 'EU' },
  { id: 'APJ6JRA9NG5V4', name: 'Italy', flag: '🇮🇹', region: 'EU' },
  { id: 'A1805IZSGTT6HS', name: 'Netherlands', flag: '🇳🇱', region: 'EU' },
  { id: 'A1VC38T7YXB528', name: 'Japan', flag: '🇯🇵', region: 'FE' },
  { id: 'A39IBJ37TRP1C6', name: 'Australia', flag: '🇦🇺', region: 'FE' },
  { id: 'A19VAU5U5O7RUS', name: 'Singapore', flag: '🇸🇬', region: 'FE' },
];

function getMarketplaceName(id: string): string {
  const m = MARKETPLACES.find((marketplace) => marketplace.id === id);
  return m ? `${m.flag} ${m.name}` : id;
}

function isEnvSelfAuthProfile(profileName: string) {
  return profileName === 'env-self-auth';
}

function formatProfileName(profile: ProfileInfo) {
  if (isEnvSelfAuthProfile(profile.profile_name)) {
    return 'Self-auth environment connection';
  }
  return profile.profile_name;
}

interface ProfileInfo {
  profile_name: string;
  api_type: string;
  marketplace_id: string;
  region?: string;
  seller_id?: string;
  advertiser_profile_id?: string;
  created_at?: number;
}

interface ConnectionStatus {
  sp_api: { connected: boolean; profiles: ProfileInfo[] };
  ads_api: { connected: boolean; profiles: ProfileInfo[] };
}

function ToastBanner({
  toast,
}: {
  toast: { type: 'success' | 'error'; message: string } | null;
}) {
  if (!toast) return null;

  return (
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
  );
}

function ProfileRow({
  profile,
  disconnecting,
  onDisconnect,
}: {
  profile: ProfileInfo;
  disconnecting: boolean;
  onDisconnect: (profileName: string, apiType: string) => void;
}) {
  const isEnvSelfAuth = isEnvSelfAuthProfile(profile.profile_name);

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-background px-4 py-3">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">
            {getMarketplaceName(profile.marketplace_id)}
          </p>
          <Badge
            variant="secondary"
            className="gap-1 bg-emerald-100 text-emerald-800"
          >
            <Check className="h-3 w-3" />
            Connected
          </Badge>
          {isEnvSelfAuth && <Badge variant="outline">Env self-auth</Badge>}
          {profile.region && <Badge variant="outline">{profile.region}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {formatProfileName(profile)}
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="font-mono">{profile.marketplace_id}</span>
          {profile.seller_id && (
            <span className="font-mono">Seller {profile.seller_id}</span>
          )}
          {profile.advertiser_profile_id && (
            <span className="font-mono">
              Ads {profile.advertiser_profile_id}
            </span>
          )}
        </div>
      </div>

      {!isEnvSelfAuth && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            >
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
                This removes the{' '}
                {profile.api_type === 'SP_API' ? 'Seller' : 'Ads'} connection
                for {getMarketplaceName(profile.marketplace_id)}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() =>
                  onDisconnect(profile.profile_name, profile.api_type)
                }
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function ConnectionCard({
  icon,
  title,
  description,
  capability,
  profiles,
  loading,
  marketplace,
  onMarketplaceChange,
  connectHref,
  connectLabel,
  disconnecting,
  onDisconnect,
  connectDisabled,
  connectHint,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  capability: string;
  profiles: ProfileInfo[];
  loading: boolean;
  marketplace: string;
  onMarketplaceChange: (value: string) => void;
  connectHref: string;
  connectLabel: string;
  disconnecting: string | null;
  onDisconnect: (profileName: string, apiType: string) => void;
  connectDisabled?: boolean;
  connectHint?: string;
}) {
  const hasProfiles = profiles.length > 0;

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{capability}</Badge>
          <Badge variant="outline">
            {hasProfiles ? `${profiles.length} connected` : 'Not connected'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking connection status…
          </div>
        ) : hasProfiles ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Connected accounts
              </p>
              {profiles.map((profile) => (
                <ProfileRow
                  key={`${profile.api_type}::${profile.profile_name}`}
                  profile={profile}
                  onDisconnect={onDisconnect}
                  disconnecting={
                    disconnecting ===
                    `${profile.api_type}::${profile.profile_name}`
                  }
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No accounts connected yet.
          </div>
        )}

        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div>
            <p className="text-sm font-medium">Add another connection</p>
            <p className="text-xs text-muted-foreground">
              Choose the marketplace to use for the next authorization flow.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select value={marketplace} onValueChange={onMarketplaceChange}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Select marketplace" />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.flag} {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {connectDisabled ? (
              <Button type="button" size="sm" disabled>
                {connectLabel}
              </Button>
            ) : (
              <Button size="sm" asChild>
                <a href={connectHref}>
                  {connectLabel}
                  <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            )}
          </div>
          {connectHint && (
            <p className="text-xs leading-5 text-muted-foreground">
              {connectHint}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [spMarketplace, setSpMarketplace] = useState('ATVPDKIKX0DER');
  const [adsMarketplace, setAdsMarketplace] = useState('ATVPDKIKX0DER');
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const showToast = useCallback(
    (type: 'success' | 'error', message: string) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), 5000);
    },
    []
  );

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/amazon/status');
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // Ignore fetch errors and keep previous state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected === 'sp_api') {
      showToast('success', 'Amazon Seller account connected successfully.');
    } else if (connected === 'ads_api') {
      showToast('success', 'Amazon Ads account connected successfully.');
    } else if (error) {
      showToast('error', decodeURIComponent(error));
    }
  }, [searchParams, showToast]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  async function handleDisconnect(profileName: string, apiType: string) {
    const key = `${apiType}::${profileName}`;
    setDisconnecting(key);
    try {
      const res = await fetch(
        `/api/amazon/disconnect?apiType=${encodeURIComponent(
          apiType
        )}&profile=${encodeURIComponent(profileName)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        showToast('success', 'Account disconnected successfully.');
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

  const spProfiles = status?.sp_api.profiles || [];
  const adsProfiles = status?.ads_api.profiles || [];
  const spUsesEnvSelfAuth = useMemo(
    () =>
      spProfiles.some((profile) => isEnvSelfAuthProfile(profile.profile_name)),
    [spProfiles]
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Keep Amazon connections tidy here, then let the rest of the app pick
            the best matching account automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1.5">
            <Layers3 className="h-3.5 w-3.5" />
            {spProfiles.length + adsProfiles.length} linked profiles
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            AI features use defaults first
          </Badge>
        </div>
      </div>

      <ToastBanner toast={toast} />

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Seller connections</CardDescription>
            <CardTitle className="text-2xl">
              {loading ? '—' : spProfiles.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ads connections</CardDescription>
            <CardTitle className="text-2xl">
              {loading ? '—' : adsProfiles.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current SP mode</CardDescription>
            <CardTitle className="text-base">
              {spUsesEnvSelfAuth ? 'Self-auth fallback' : 'Website OAuth'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ConnectionCard
          icon={<ShoppingCart className="h-5 w-5 text-orange-600" />}
          title="Amazon Seller Account"
          description="Catalog, listings, inventory, and other SP-API-backed product data."
          capability="SP-API"
          profiles={spProfiles}
          loading={loading}
          marketplace={spMarketplace}
          onMarketplaceChange={setSpMarketplace}
          connectHref={`/api/amazon/sp-connect?marketplace=${spMarketplace}`}
          connectLabel="Connect Seller Account"
          disconnecting={disconnecting}
          onDisconnect={handleDisconnect}
          connectDisabled={spUsesEnvSelfAuth}
          connectHint={
            spUsesEnvSelfAuth
              ? 'This workspace is currently using env-based self-auth for SP-API. Keep it for development, or switch to public OAuth once the Amazon app is fully configured.'
              : 'Use public OAuth once the Seller Central app exposes login and redirect URI settings.'
          }
        />

        <ConnectionCard
          icon={<Megaphone className="h-5 w-5 text-blue-600" />}
          title="Amazon Ads Account"
          description="Advertiser profiles, brand discovery, and Ads-backed planning signals."
          capability="Ads API"
          profiles={adsProfiles}
          loading={loading}
          marketplace={adsMarketplace}
          onMarketplaceChange={setAdsMarketplace}
          connectHref={`/api/amazon/ads-connect?marketplace=${adsMarketplace}`}
          connectLabel="Connect Ads Account"
          disconnecting={disconnecting}
          onDisconnect={handleDisconnect}
          connectHint="Ads OAuth is working now, so this is the path to add more advertiser profiles and marketplaces."
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" />
            How the app chooses a connection
          </CardTitle>
          <CardDescription>
            Most screens do not ask for region first. SellAvant tries the
            default connection, then the best compatible profile for the feature
            you are using.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="font-medium text-foreground">
              1. Connected accounts live here
            </p>
            <p className="mt-1">
              Add Seller and Ads access once, then let drafts and tools reuse
              them.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="font-medium text-foreground">
              2. Features pick defaults
            </p>
            <p className="mt-1">
              Chat, A+, and diagnostics all resolve the best usable profile
              automatically.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="font-medium text-foreground">
              3. Multiple accounts still work
            </p>
            <p className="mt-1">
              When more than one marketplace or advertiser fits, the feature can
              ask for a narrower choice.
            </p>
          </div>
        </CardContent>
      </Card>
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
