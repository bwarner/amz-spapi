import { auth0 } from "@/lib/auth0";
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Login() {
  const session = await auth0.getSession();

  if (session) {
    redirect('/chat');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <span className="text-lg font-bold text-primary-foreground">S</span>
          </div>
          <CardTitle className="text-2xl">Sign in to Sellavant</CardTitle>
          <CardDescription>
            Access your Amazon seller dashboard and AI assistant
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button className="w-full" size="lg" asChild>
            <a href="/auth/login?returnTo=/chat">
              Continue with Auth0
            </a>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{' '}
            <a href="/auth/login?screen_hint=signup&returnTo=/chat" className="underline hover:text-foreground">
              Sign up
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
