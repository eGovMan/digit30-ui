<script lang="ts">
    import "../styles/main.css";
    import { onDestroy, onMount, untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { base } from "$app/paths";
    import { page } from "$app/stores";
    import { env as envPublic } from "$env/dynamic/public";
    import { error } from "$lib/stores/errors";
    import { createSettingsStore } from "$lib/stores/settings";
    import { shareConversation } from "$lib/shareConversation";
    import Toast from "$lib/components/Toast.svelte";
    import NavMenu from "$lib/components/NavMenu.svelte";
    import MobileNav from "$lib/components/MobileNav.svelte";
    import titleUpdate from "$lib/stores/titleUpdate";
    import DisclaimerModal from "$lib/components/DisclaimerModal.svelte";
    import ExpandNavigation from "$lib/components/ExpandNavigation.svelte";
    import { loginModalOpen } from "$lib/stores/loginModal";
    import LoginModal from "$lib/components/LoginModal.svelte";
    import OverloadedModal from "$lib/components/OverloadedModal.svelte";
    import { isHuggingChat } from "$lib/utils/isHuggingChat";
    import { browser } from "$app/environment";

    // Define User type to match expected shape from /api/session
    interface User {
        id: string;
        username: string;
        avatarUrl: string | undefined;
        email: string | undefined;
        logoutDisabled: boolean | undefined;
        isAdmin: boolean;
        isEarlyAccess: boolean;
    }

    let { data = $bindable(), children } = $props();

    // Reactive state for user and conversations
    let user = $state<User | null | undefined>(data.user); // Explicitly allow null
    let canLogin = $state(user === null || user === undefined);
    let conversations = $state(data.conversations);

    $effect(() => {
        data.conversations && untrack(() => (conversations = data.conversations));
        canLogin = user === null || user === undefined;
    });

    let isNavCollapsed = $state(false);
    let overloadedModalOpen = $state(false);
    let errorToastTimeout: ReturnType<typeof setTimeout>;
    let currentError: string | undefined = $state();

    let sessionId: string | null = null;

    // LoginModal props
    let accountname = $state("");
    let username = $state("");
    let accountExists: boolean | null = $state(null);

    // Define signIn and checkAccount before use
    async function signIn() {
        try {
            const sessionId = crypto.randomUUID();
            const response = await fetch(`${base}/api/login?accountname=${accountname}&sessionId=${sessionId}`, {
                credentials: "include",
            });
            if (!response.ok) {
                throw new Error(`Failed to initiate login: ${response.statusText}`);
            }
            const { authUrl } = await response.json();
            window.location.href = authUrl; // Redirect to Keycloak
        } catch (err) {
            console.error("Sign-in failed:", err);
            $error = "Failed to sign in. Please try again.";
        }
    }

    // src/routes/+layout.svelte
    async function checkAccount() {
    if (!accountname?.trim()) {
        accountExists = null;
        return;
    }

    try {
        const kongProxyUrl = envPublic.KONG_PROXY_URL || "http://localhost:8000";
        const response = await fetch(`${kongProxyUrl}/account-service/check-account?accountname=${encodeURIComponent(accountname)}`);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to check account: ${response.status} - ${text}`);
        }
        const data = await response.json();
        accountExists = data.exists;
    } catch (err) {
        console.error("Check account failed:", err);
        $error = err.message || "Failed to check account existence.";
    }
}

    // Consolidated onMount
    onMount(() => {
        if (browser) {
            syncSession();
            sessionId = document.cookie.split("; ").find(row => row.startsWith("session="))?.split("=")[1] || null;

            if ($page.url.searchParams.has("model")) {
                settings.instantSet({
                    activeModel: $page.url.searchParams.get("model") ?? $settings.activeModel,
                }).then(async () => {
                    const query = new URLSearchParams($page.url.searchParams.toString());
                    query.delete("model");
                    await goto(`${base}/?${query.toString()}`, { invalidateAll: true });
                });
            }

            if ($page.url.searchParams.has("tools")) {
                const tools = $page.url.searchParams.get("tools")?.split(",");
                settings.instantSet({
                    tools: [...($settings.tools ?? []), ...(tools ?? [])],
                }).then(async () => {
                    const query = new URLSearchParams($page.url.searchParams.toString());
                    query.delete("tools");
                    await goto(`${base}/?${query.toString()}`, { invalidateAll: true });
                });
            }
        }

        const refreshInterval = setInterval(async () => {
            if (!browser) return;
            const response = await fetch("/api/refresh", { method: "POST", credentials: "include" });
            if (!response.ok) {
                console.error("Token refresh failed");
            } else {
                const { expiresIn } = await response.json();
                console.log("Token refreshed, expires in:", expiresIn);
            }
        }, 15 * 60 * 1000); // Refresh every 15 minutes

        return () => clearInterval(refreshInterval);
    });

    // Sync on navigation change
    $effect(() => {
        $page.url;
        if (browser) syncSession();
    });

    async function syncSession() {
        if (!browser) return;
        if ($page.url.pathname === `${base}/login`) return; // Avoid redirect loop
        try {
            const response = await fetch(`${base}/api/session`, { credentials: "include" });
            console.log("Session response status:", response.status);
            if (response.ok) {
                const { user: userData } = await response.json();
                user = userData;
                canLogin = false;
                console.log("Client synced user:", user);
            } else {
                console.log("No active session, redirecting to login, status:", response.status);
                user = null;
                canLogin = true;
                $loginModalOpen = true;                
            }
        } catch (err) {
            console.error("Error syncing session:", err);
            user = null;
            canLogin = true;
            $loginModalOpen = true;
        }
    }

    async function onError() {
        if ($error && currentError && $error !== currentError) {
            clearTimeout(errorToastTimeout);
            currentError = undefined;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        currentError = $error;
        if (currentError === "Model is overloaded") {
            overloadedModalOpen = true;
        }
        errorToastTimeout = setTimeout(() => {
            $error = undefined;
            currentError = undefined;
        }, 10000);
    }

    async function deleteConversation(id: string) {
        try {
            console.log(base);
            const res = await fetch(`${base}/conversation/${id}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
            });
            if (!res.ok) {
                $error = "Error while deleting conversation, try again.";
                return;
            }
            conversations = conversations.filter((conv) => conv.id !== id);
            if ($page.params.id === id) {
                await goto(`${base}/`, { invalidateAll: true });
            }
        } catch (err) {
            console.error(err);
            $error = String(err);
        }
    }

    async function editConversationTitle(id: string, title: string) {
        try {
            const res = await fetch(`${base}/conversation/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
            });
            if (!res.ok) {
                $error = "Error while editing title, try again.";
                return;
            }
            conversations = conversations.map((conv) => (conv.id === id ? { ...conv, title } : conv));
        } catch (err) {
            console.error(err);
            $error = String(err);
        }
    }

    onDestroy(() => {
        clearTimeout(errorToastTimeout);
    });

    $effect(() => {
        if ($error) onError();
    });

    $effect(() => {
        if ($titleUpdate) {
            const convIdx = conversations.findIndex(({ id }) => id === $titleUpdate?.convId);
            if (convIdx !== -1) {
                conversations[convIdx].title = $titleUpdate?.title ?? conversations[convIdx].title;
            }
            $titleUpdate = null;
        }
    });

    const settings = createSettingsStore(data.settings);

    let mobileNavTitle = $derived(
        ["/models", "/assistants", "/privacy", "/tools"].includes($page.route.id ?? "")
            ? ""
            : conversations.find((conv) => conv.id === $page.params.id)?.title
    );

    let showDisclaimer = $derived(
        !$settings.ethicsModalAccepted &&
        $page.url.pathname !== `${base}/privacy` &&
        envPublic.PUBLIC_APP_DISCLAIMER === "1" &&
        !($page.data.shared === true)
    );

    async function handleLogout() {
        if (!browser) return;

        try {
            const sessionResponse = await fetch("/api/session", {
                method: "GET",
                credentials: "include",
            });

            if (!sessionResponse.ok) {
                throw new Error("Failed to fetch session data");
            }

            const { refreshToken } = await sessionResponse.json();
            const keycloakUrl = "http://localhost:8080/realms/eGov/protocol/openid-connect/logout";
            const clientId = "eGov-client";
            const redirectUri = `${window.location.origin}${base}/`;

            const logoutParams = new URLSearchParams({
                client_id: clientId,
                refresh_token: refreshToken,
                post_logout_redirect_uri: redirectUri,
            });

            const response = await fetch(`${keycloakUrl}?${logoutParams.toString()}`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });

            if (!response.ok) {
                throw new Error(`Logout failed: ${response.status} ${response.statusText}`);
            }

            await fetch("/api/logout", { method: "POST", credentials: "include" });
            user = null;
            canLogin = true;
            $loginModalOpen = true; // Show modal instead of redirecting
        } catch (err) {
            console.error("Logout error:", err);
            user = null;
            canLogin = true;
            $loginModalOpen = true; // Show modal instead of redirecting
        }
    }
</script>

<svelte:head>
    <title>{envPublic.PUBLIC_APP_NAME}</title>
    <meta name="description" content="Open Source Platform for Public Service Delivery" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@eGovFoundation" />
    {#if !$page.url.pathname.includes("/assistant/") && $page.route.id !== "/assistants" && !$page.url.pathname.includes("/models/") && !$page.url.pathname.includes("/tools")}
        <meta property="og:title" content={envPublic.PUBLIC_APP_NAME} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}" />
        <meta
            property="og:image"
            content="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/thumbnail.png"
        />
        <meta property="og:description" content={envPublic.PUBLIC_APP_DESCRIPTION} />
    {/if}
    <link
        rel="icon"
        href="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/favicon.ico"
        sizes="32x32"
    />
    <link
        rel="icon"
        href="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/icon.svg"
        type="image/svg+xml"
    />
    <link
        rel="apple-touch-icon"
        href="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/apple-touch-icon.png"
    />
    <link
        rel="manifest"
        href="{envPublic.PUBLIC_ORIGIN || $page.url.origin}{base}/{envPublic.PUBLIC_APP_ASSETS}/manifest.json"
    />
    {#if envPublic.PUBLIC_PLAUSIBLE_SCRIPT_URL && envPublic.PUBLIC_ORIGIN}
        <script
            defer
            data-domain={new URL(envPublic.PUBLIC_ORIGIN).hostname}
            src={envPublic.PUBLIC_PLAUSIBLE_SCRIPT_URL}
        ></script>
    {/if}
    {#if envPublic.PUBLIC_APPLE_APP_ID}
        <meta name="apple-itunes-app" content={`app-id=${envPublic.PUBLIC_APPLE_APP_ID}`} />
    {/if}
</svelte:head>

{#if showDisclaimer}
    <DisclaimerModal on:close={() => ($settings.ethicsModalAccepted = true)} />
{/if}

{#if $loginModalOpen}
    <LoginModal
        {accountname}
        {username}
        {accountExists}
        {signIn}
        {checkAccount}
        events={{ close: () => ($loginModalOpen = false), register: () => console.log("Register clicked") }}
    />
{/if}

{#if overloadedModalOpen && isHuggingChat}
    <OverloadedModal onClose={() => (overloadedModalOpen = false)} />
{/if}

<div
    class="fixed grid h-full w-screen grid-cols-1 grid-rows-[auto,1fr] overflow-hidden text-smd {!isNavCollapsed
        ? 'md:grid-cols-[290px,1fr]'
        : 'md:grid-cols-[0px,1fr]'} transition-[300ms] [transition-property:grid-template-columns] dark:text-gray-300 md:grid-rows-[1fr]"
>
    <ExpandNavigation
        isCollapsed={isNavCollapsed}
        onClick={() => (isNavCollapsed = !isNavCollapsed)}
        classNames="absolute inset-y-0 z-10 my-auto {!isNavCollapsed ? 'left-[290px]' : 'left-0'} *:transition-transform"
    />
    <MobileNav title={mobileNavTitle}>
        <NavMenu
            {conversations}
            {user}
            {canLogin}
            on:logout={handleLogout}
            on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
            on:deleteConversation={(ev) => deleteConversation(ev.detail)}
            on:editConversationTitle={(ev) => editConversationTitle(ev.detail.id, ev.detail.title)}
        />
    </MobileNav>
    <nav class="grid max-h-screen grid-cols-1 grid-rows-[auto,1fr,auto] overflow-hidden *:w-[290px] max-md:hidden">
        <NavMenu
            {conversations}
            {user}
            {canLogin}
            on:logout={handleLogout}
            on:shareConversation={(ev) => shareConversation(ev.detail.id, ev.detail.title)}
            on:deleteConversation={(ev) => deleteConversation(ev.detail)}
            on:editConversationTitle={(ev) => editConversationTitle(ev.detail.id, ev.detail.title)}
        />
    </nav>
    {#if currentError}
        <Toast message={currentError} />
    {/if}
    {#if children}
        {@render children()}
    {:else}
        <p>Loading page...</p>
    {/if}
</div>