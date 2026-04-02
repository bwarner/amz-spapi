"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

function CallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    // This callback page is primarily for diagnostics.
    // Normal auth flow redirects to /chat via returnTo parameter.
    const error = searchParams.get('error');
    if (!error) {
      window.location.href = '/chat';
    }
  }, [searchParams]);

  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-destructive">Authentication Error</h1>
          <p className="mt-2 text-muted-foreground">{errorDescription || error}</p>
          <a href="/login" className="mt-4 inline-block text-primary hover:underline">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Redirecting...</p>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
