<script lang="ts">
    import { goto } from "$app/navigation";
    import { base } from "$app/paths";
    import { page } from "$app/stores";
    import { env as envPublic } from "$env/dynamic/public";
    import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
    import LoginModal from "$lib/components/LoginModal.svelte";
    import { ERROR_MESSAGES, error } from "$lib/stores/errors";
    import { pendingMessage } from "$lib/stores/pendingMessage";
    import { useSettingsStore } from "$lib/stores/settings.js";
    import { findCurrentModel } from "$lib/utils/models";
    import { onMount } from "svelte";
    import { browser } from "$app/environment";
    import { loginModalOpen } from "$lib/stores/loginModal";

    let { data } = $props();
    let loading = $state(false);
    let files: File[] = $state([]);
    let showRegisterModal = $state(false);
    let accountname = $state('');
    let username = $state('');
    let adminEmail = $state('');
    let password = $state('');
    let accountExists = $state<boolean | null>(null);
    let isAuthenticated = $state(false);
    let authUrl = $state<string | null>(null);

    const settings = useSettingsStore();

    async function checkAuth() {
        try {
            const response = await fetch(`${base}/api/session`, { credentials: 'include' });
            console.log('Session check response status:', response.status);
            if (response.ok) {
                isAuthenticated = true;
                console.log('User is authenticated');
            } else {
                isAuthenticated = false;
                console.log('User is not authenticated');
            }
        } catch (err) {
            console.error('Error in checkAuth:', err);
            isAuthenticated = false;
        }
    }

    onMount(async () => {
        const query = $page.url.searchParams.get("q");
        if (query) {
            await createConversation(query);
        }
        await checkAuth();

        if (browser) {
            page.subscribe(async (value) => {
                console.log('Page subscription triggered:', value.url.pathname);
                await checkAuth();
            });
        }
    });

    async function checkAccount() {
        if (!accountname) return;
        try {

			const kongProxyUrl = envPublic.KONG_PROXY_URL || "http://localhost:8000"; 
			if (!kongProxyUrl) {
				throw new Error("KONG_PROXY_URL is not defined in environment variables");
			}
			const accountServiceRoute = "/account-service"; 
			const accountServiceUrl = `${kongProxyUrl}${accountServiceRoute}`;
			const REDIRECT_BASE_URL = 'http://localhost:5173'; // Full base URL for redirect
            const response = await fetch(`${accountServiceUrl}/client/${accountname}`);
            if (!response.ok) {
                accountExists = false;
                authUrl = null;
                console.log('Account not found');
                return;
            }
            const data = await response.json();
            accountExists = true;
            authUrl = data.authUrl;
            console.log('Account details fetched:', { authUrl });
        } catch (err) {
            console.error('Error in checkAccount:', err);
            accountExists = null;
            authUrl = null;
        }
    }

    async function signIn() {
        console.log('signIn called - accountname:', accountname, 'username:', username);
        if (!accountname || !username) {
            alert('Account name and username required');
            return;
        }
        if (accountExists === false) {
            alert('Please enter a valid account name');
            return;
        }
        const sessionId = crypto.randomUUID();
        try {
            const response = await fetch(`${base}/api/login?accountname=${accountname}&sessionId=${sessionId}`, {
                credentials: 'include'
            });
            if (!response.ok) {
                console.error('Failed to initiate login:', await response.text());
                alert('Failed to initiate login');
                return;
            }
            const { authUrl } = await response.json();
            console.log('Generated CSRF state and auth URL from /api/login:', { sessionId, authUrl });
            window.location.href = authUrl;
        } catch (err) {
            console.error('Error in signIn:', err);
            alert('An error occurred during sign-in');
        }
    }

    async function register() {
        if (!accountname || !adminEmail || !password) {
            alert('Account name, admin email, and password are required');
            return;
        }
        try {
			const kongProxyUrl = envPublic.KONG_PROXY_URL || "http://localhost:8000"; 
			if (!kongProxyUrl) {
				throw new Error("KONG_PROXY_URL is not defined in environment variables");
			}
			const accountServiceRoute = "/account-service"; 
			const accountServiceUrl = `${kongProxyUrl}${accountServiceRoute}`;
			const REDIRECT_BASE_URL = 'http://localhost:5173'; // Full base URL for redirect
            const response = await fetch(`${accountServiceUrl}/create-account`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountname, adminEmail, password })
            });
            if (!response.ok) {
                const { error: errMsg } = await response.json();
                alert(`Failed to create account: ${errMsg || 'Unknown error'}`);
                return;
            }
            alert('Account created successfully! Please sign in.');
            showRegisterModal = false;
            loginModalOpen.set(true);
        } catch (err) {
            console.error('Error in register:', err);
            alert('An error occurred during registration');
        }
    }

    async function createConversation(message: string) {
        try {
            loading = true;
            const validModels = data.models.map((model) => model.id);
            let model;
            if (validModels.includes($settings.activeModel)) {
                model = $settings.activeModel;
            } else {
                if (validModels.includes(data.assistant?.modelId)) {
                    model = data.assistant?.modelId;
                } else {
                    model = data.models[0].id;
                }
            }
            const res = await fetch(`${base}/conversation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    preprompt: $settings.customPrompts[$settings.activeModel],
                    assistantId: data.assistant?._id,
                }),
            });

            if (!res.ok) {
                const errorMessage = (await res.json()).message || ERROR_MESSAGES.default;
                error.set(errorMessage);
                console.error("Error while creating conversation: ", errorMessage);
                return;
            }

            const { conversationId } = await res.json();
            pendingMessage.set({ content: message, files });
            await goto(`${base}/conversation/${conversationId}`, { invalidateAll: true });
        } catch (err) {
            error.set((err as Error).message || ERROR_MESSAGES.default);
            console.error(err);
        } finally {
            loading = false;
        }
    }

    let currentModel = $derived(
        findCurrentModel(
            [...data.models, ...data.oldModels],
            !$settings.assistants.includes($settings.activeModel)
                ? $settings.activeModel
                : data.assistant?.modelId
        )
    );
</script>

<svelte:head>
    <title>{envPublic.PUBLIC_APP_NAME}</title>
</svelte:head>

{#if isAuthenticated}
    <ChatWindow
        on:message={(ev) => createConversation(ev.detail)}
        {loading}
        assistant={data.assistant}
        {currentModel}
        models={data.models}
        bind:files
    />
{:else if $loginModalOpen}
    <LoginModal
        bind:accountname
        bind:username
        {accountExists}
        {signIn}
        {checkAccount}
        events={{
            close: () => loginModalOpen.set(false),
            register: () => { loginModalOpen.set(false); showRegisterModal = true; }
        }}
    />
{:else if showRegisterModal}
    <div class="modal">
        <div class="modal-content">
            <h2>Register New Account</h2>
            <input type="text" placeholder="Account Name" bind:value={accountname} />
            <input type="email" placeholder="Admin Email" bind:value={adminEmail} />
            <input type="password" placeholder="Password" bind:value={password} />
            <button onclick={register}>Register</button>
            <button onclick={() => { showRegisterModal = false; loginModalOpen.set(true); }}>Back to Login</button>
            <button onclick={() => (showRegisterModal = false)}>Close</button>
        </div>
    </div>
{:else}
    <ChatWindow
        on:message={(ev) => createConversation(ev.detail)}
        {loading}
        assistant={data.assistant}
        {currentModel}
        models={data.models}
        bind:files
    />
{/if}

<style>
    .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .modal-content {
        background: white;
        padding: 20px;
        border-radius: 5px;
        text-align: center;
    }
    input {
        display: block;
        margin: 10px 0;
        padding: 5px;
    }
</style>