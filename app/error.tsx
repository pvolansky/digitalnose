'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="container form"><h1>We couldn’t load this page.</h1><p>Check your connection. For a new installation, apply the Supabase migrations before signing in.</p><button onClick={reset}>Try again</button></main>}
