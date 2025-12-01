"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";


export default function CallbackPage() {
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const params: Record<string, string | null> = {};
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
    setDiagnostics(params);
    setIsLoading(false);
  }, [searchParams]);

  if (isLoading) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace' }}>
        <h1>Auth0 Callback Page</h1>
        <p>Loading diagnostic information...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Auth0 Callback Page - Diagnostics</h1>
      {Object.keys(diagnostics).length === 0 ? (
        <p>No URL parameters found.</p>
      ) : (
        <div>
          <h2>URL Parameters:</h2>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', overflowX: 'auto' }}>
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
          {diagnostics.error && (
            <div style={{ color: 'red', marginTop: '15px', border: '1px solid red', padding: '10px', borderRadius: '5px' }}>
              <h2>Error Detected!</h2>
              <p><strong>Error:</strong> {diagnostics.error}</p>
              {diagnostics.error_description && <p><strong>Description:</strong> {diagnostics.error_description}</p>}
              {diagnostics.state && <p><strong>State:</strong> {diagnostics.state}</p>}
            </div>
          )}
        </div>
      )}
      <p style={{ marginTop: '20px', fontSize: '0.9em', color: '#666' }}>
        This page displays URL parameters received during the Auth0 callback process.
        In a production environment, this page would typically handle token exchange and redirect the user.
      </p>
    </div>
  );
}