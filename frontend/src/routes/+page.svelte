<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { onMount } from 'svelte';

  const backendUrl = env.PUBLIC_BACKEND_URL || 'http://localhost:3001';

  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let message = '';

  onMount(async () => {
    status = 'loading';

    try {
      const response = await fetch(`${backendUrl}/health`);
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }
      const data = await response.json();
      status = 'success';
      message = `Backend svarar: ${JSON.stringify(data)}`;
    } catch (error) {
      status = 'error';
      message = `Kunde inte nå backend: ${(error as Error).message}`;
    }
  });
</script>

<svelte:head>
  <title>Course Builder</title>
</svelte:head>

<main>
  <h1>Course Builder</h1>
  <p>
    Detta reposkelett använder <strong>SvelteKit</strong> i frontend, en
    <strong>Node.js</strong>-backend och <strong>Postgres</strong> som databas.
  </p>

  <section>
    <h2>Status för backend</h2>
    {#if status === 'idle' || status === 'loading'}
      <p>Kontrollerar anslutningen mot backend på <code>{backendUrl}</code>…</p>
    {:else if status === 'success'}
      <p class="success">{message}</p>
    {:else}
      <p class="error">{message}</p>
    {/if}
  </section>

  <section>
    <h2>Nästa steg</h2>
    <ol>
      <li>Installera beroenden i <code>frontend</code> och <code>backend</code>.</li>
      <li>
        Använd <code>docker compose up</code> för att starta Postgres, backend och frontend i
        utvecklingsläge.
      </li>
      <li>Bygg vidare på skelettet med din applikationslogik.</li>
    </ol>
  </section>
</main>

<style>
  main {
    max-width: 60rem;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  h1 {
    margin-bottom: 1rem;
  }

  section {
    margin-top: 2rem;
    padding: 1.5rem;
    border-radius: 0.75rem;
    background: #f8f9fb;
    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05);
  }

  code {
    font-size: 0.95em;
    background: rgba(15, 23, 42, 0.08);
    padding: 0.1rem 0.35rem;
    border-radius: 0.35rem;
  }

  .success {
    color: #1a7f37;
  }

  .error {
    color: #d32f2f;
  }
</style>
