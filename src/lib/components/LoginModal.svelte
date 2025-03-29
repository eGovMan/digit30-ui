<script lang="ts">
    import { base } from "$app/paths";
    import { env as envPublic } from "$env/dynamic/public";
    import Modal from "$lib/components/Modal.svelte";
    import { useSettingsStore } from "$lib/stores/settings";

    const settings = useSettingsStore();

    // Props for integration with +page.svelte
    export let accountname: string;
    export let username: string;
    export let accountExists: boolean | null;
    export let signIn: () => Promise<void>;
    export let checkAccount: () => Promise<void>;

    // Define event handlers for Svelte 5
    export let events = {
        close: () => {},
        register: () => {}
    };

    // Log values for debugging
    $: console.log('LoginModal - accountname:', accountname, 'username:', username);
</script>

<Modal on:close={() => events.close()} width="!max-w-[400px] !m-4">
    <div
        class="from-primary-500/40 via-primary-500/10 to-primary-500/0 flex w-full flex-col items-center gap-6 bg-gradient-to-b px-5 pb-8 pt-9 text-center"
    >
        <h2 class="flex items-center text-2xl font-semibold text-gray-800">
            {envPublic.PUBLIC_APP_NAME}
        </h2>
        <div class="flex w-full flex-col gap-2">
            <input
                type="text"
                placeholder="Account Name"
                bind:value={accountname}
                on:blur={checkAccount}
                class="w-full rounded-md border p-2"
            />
            {#if accountExists === false}
                <span class="text-red-500">Account not found</span>
            {/if}
            <input
                type="text"
                placeholder="Username"
                bind:value={username}
                class="w-full rounded-md border p-2"
            />
            <button
                on:click={signIn}
                class="flex w-full items-center justify-center rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
            >
                Sign In
            </button>
            <button
                on:click={() => events.register()}
                class="flex w-full items-center justify-center rounded-md border px-5 py-2 text-lg font-semibold text-gray-800 hover:bg-gray-100"
            >
                Register
            </button>
        </div>
    </div>
</Modal>