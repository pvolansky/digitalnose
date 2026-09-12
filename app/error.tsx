'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="container form">
      <h1>Let’s reconnect.</h1>
      <p>This page is temporarily unavailable. Try again in a moment.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
