import { auth0 } from "@/lib/auth0";
import { redirect } from 'next/navigation';

export default async function Login() {
  const session = await auth0.getSession();
  
  // Server-side redirect if already authenticated
  if (session) {
    redirect('/dashboard');
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Sign in to Totem Sports</h1>
        <p>Access your account and manage your sports activities</p>
        <a href="/auth/login" className="btn-primary">
          Continue with Auth0
        </a>
      </div>
    </div>
  );
}