<script lang="ts">
    import { browser } from "$app/environment";
    import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
    import { accountSettings } from "$lib/stores/accountSettings";
    import { afterNavigate } from "$app/navigation";
    import { base } from "$app/paths";
    import { onMount } from "svelte";
    import { env as envPublic } from "$env/dynamic/public";

    export let data: { kongProxyUrl: string };

    let loading: boolean;
    let accountError: string | null;
    let accountname: string;
    let adminEmail: string | null;
    let adminPhone: string | null;
    let oidc: typeof accountSettings['oidc'];
    let models: typeof accountSettings['models'];
    let textEmbeddingModels: typeof accountSettings['textEmbeddingModels'];
    let saving: boolean;
    let saveError: string | null;

    accountSettings.subscribe((value) => {
        console.log("Store state:", value);
        loading = value.loading;
        accountError = value.error;
        accountname = value.accountname;
        adminEmail = value.adminEmail;
        adminPhone = value.adminPhone;
        oidc = value.oidc;
        models = value.models;
        textEmbeddingModels = value.textEmbeddingModels;
        saving = value.saving;
        saveError = value.saveError;
    });

    onMount(() => {
        if (browser) fetchAccountDetails();
    });

    afterNavigate(() => {
        if (browser) fetchAccountDetails();
    });

    async function fetchAccountDetails() {
        try {
            const response = await fetch(`${base}/api/session`, { credentials: "include" });
            if (!response.ok) {
                throw new Error(`Session fetch failed: ${response.status} ${response.statusText}`);
            }
            const sessionData = await response.json();
            const accountName = sessionData.user.accountName;
            const kongProxyUrl = envPublic.KONG_PROXY_URL || "http://localhost:8000";
            console.log("Fetching account with:", accountName, kongProxyUrl);
            await accountSettings.fetchAccount(accountName, kongProxyUrl);
        } catch (err) {
            console.error("Error fetching session:", err);
            await accountSettings.fetchAccount("eGov", data.kongProxyUrl);
        }
    }

    async function handleSave() {
        const kongProxyUrl = envPublic.KONG_PROXY_URL || "http://localhost:8000";
        await accountSettings.saveAccount(accountname, kongProxyUrl);
    }
</script>

<div class="flex w-full flex-col gap-5">
    <h2 class="text-center text-xl font-semibold text-gray-800 md:text-left">Account Details</h2>
    <div class="flex h-full max-w-2xl flex-col gap-4 max-sm:pt-0">
        {#if loading}
            <p>Loading account details...</p>
        {:else if accountError}
            <p class="text-red-500">Error: {accountError}</p>
        {:else}
            <div class="flex flex-col gap-2">
                <label>
                    <strong>Account Name:</strong>
                    <input type="text" value={accountname} disabled class="border rounded p-1 w-full bg-gray-100" />
                </label>
                <label>
                    <strong>Admin Email:</strong>
                    <input type="email" bind:value={adminEmail} class="border rounded p-1 w-full" />
                </label>
                <label>
                    <strong>Admin Phone:</strong>
                    <input type="tel" bind:value={adminPhone} class="border rounded p-1 w-full" />
                </label>
            </div>

            <h4 class="text-md font-semibold text-gray-700">OIDC Configuration</h4>
            {#if oidc}
                <div class="flex flex-col gap-2">
                    <label>
                        <strong>Client ID:</strong>
                        <input type="text" bind:value={oidc.clientId} class="border rounded p-1 w-full" />
                    </label>
                    <label>
                        <strong>Auth URL:</strong>
                        <div class="flex gap-2">
                            <input type="url" bind:value={oidc.authUrl} class="border rounded p-1 w-full" />
                            <a href={oidc.authUrl} target="_blank" class="text-blue-500 hover:underline">
                                <CarbonArrowUpRight />
                            </a>
                        </div>
                    </label>
                    <label>
                        <strong>Redirect URI:</strong>
                        <input type="url" bind:value={oidc.redirectUri} class="border rounded p-1 w-full" />
                    </label>
                    <label>
                        <strong>Scopes:</strong>
                        <input type="text" bind:value={oidc.scopes} class="border rounded p-1 w-full" />
                    </label>
                </div>
            {:else}
                <p>No OIDC configuration available</p>
            {/if}

            <h4 class="text-md font-semibold text-gray-700">Models</h4>
            <ul class="list-disc pl-5">
                {#each models as model}
                    <li>
                        <input type="text" bind:value={model.name} class="border rounded p-1" /> -
                        <input type="text" bind:value={model.description} class="border rounded p-1" />
                    </li>
                {/each}
            </ul>

            <h4 class="text-md font-semibold text-gray-700">Text Embedding Models</h4>
            <ul class="list-disc pl-5">
                {#each textEmbeddingModels as embeddingModel}
                    <li>
                        <input type="text" bind:value={embeddingModel.name} class="border rounded p-1" /> -
                        <input type="text" bind:value={embeddingModel.description} class="border rounded p-1" />
                    </li>
                {/each}
            </ul>

            <div class="mt-4">
                <button
                    on:click={handleSave}
                    disabled={saving}
                    class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
                >
                    {saving ? "Saving..." : "Save Changes"}
                </button>
                {#if saveError}
                    <p class="text-red-500 mt-2">Save Error: {saveError}</p>
                {/if}
            </div>
        {/if}
    </div>
</div>