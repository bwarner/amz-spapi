"use client";
import { useUser } from '@auth0/nextjs-auth0';
import { Button } from "./ui/button";

export default function SignupLogin() {
  const { user, error, isLoading } = useUser();
  console.log('user ', user);
  console.log('error', error);
  console.log('isLoading ', isLoading);

  if (isLoading) return <div>Loading...</div>;
  // if (error) return <div>Error {error.message}</div>;

  if (user) {
    return (
      <div className="flex items-center space-x-4">
        <span className="hidden md:inline text-sm text-gray-600">
          Welcome, {user.name}
        </span>
        <Button 
          variant="ghost" 
          size="sm" 
          className="hidden md:inline-flex"
          onClick={() => window.location.href = '/auth/logout'}
        >
          Logout
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-4">
      <Button 
        variant="ghost" 
        size="sm" 
        className="hidden md:inline-flex"
        onClick={() => window.location.href = '/auth/login?returnTo=/login/callback'}
      >
        Sign In
      </Button>
      <Button 
        size="sm" 
        className="bg-secondary text-secondary-foreground hover:bg-secondary/90"
        onClick={() => window.location.href = '/auth/login?screen_hint=signup&returnTo=/login/callback'}
      >
        Get Started
      </Button>
    </div>
  );
}