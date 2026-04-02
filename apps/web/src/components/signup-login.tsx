"use client";
import { useUser } from '@auth0/nextjs-auth0';
import { Button } from "./ui/button";
import { LogIn } from 'lucide-react';

export default function SignupLogin() {
  const { user, isLoading } = useUser();

  if (isLoading) return null;

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline text-sm text-muted-foreground truncate max-w-[120px]">
          {user.name}
        </span>
        <Button variant="ghost" size="sm" asChild>
          <a href="/chat">Dashboard</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="hidden sm:inline-flex"
        onClick={() => window.location.href = '/auth/login?returnTo=/chat'}
      >
        Sign In
      </Button>
      {/* Mobile: icon-only sign in */}
      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        onClick={() => window.location.href = '/auth/login?returnTo=/chat'}
        aria-label="Sign in"
      >
        <LogIn className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        className="bg-secondary text-secondary-foreground hover:bg-secondary/90"
        onClick={() => window.location.href = '/auth/login?screen_hint=signup&returnTo=/chat'}
      >
        Get Started
      </Button>
    </div>
  );
}
