import { Common } from '@ethereumjs/common';
import { TransactionFactory } from '@ethereumjs/tx';
import { bufferToHex } from '@ethereumjs/util';
import {
  SeverityLevel,
  UserInputEventType,
  type OnHomePageHandler,
  type OnRpcRequestHandler,
  type OnTransactionHandler,
  type OnUserInputHandler,
  type Transaction,
} from '@metamask/snaps-sdk';
import type { TextColors } from '@metamask/snaps-sdk/jsx';
import {
  Box,
  Button,
  Text,
  Bold,
  Banner,
  Container,
  Field,
  Footer,
  Form,
  Heading,
  Input,
  Row,
  Section,
} from '@metamask/snaps-sdk/jsx';

import { formatSummaryStatus, toChecksSummary } from './lib/checks-summary';
import { rlpHexToKeccak256Hash } from './utils/hash';

/** Base URL for Cerberus HTTP APIs (from build-time `REQUESTS_URL` or default). */
const REQUESTS_URL = process.env.REQUESTS_URL ?? 'https://api.localhost';

type RawTransactionPayload = {
  rawTx: string;
  chain: string;
  from: string;
  origin: string;
  timestamp: number;
};

type RequestResponse = {
  id: number;
};

type CheckProgress = {
  status?: string;
  checks?: {
    parseCheck?: string;
    whitelistCheck?: string;
    blacklistCheck?: string;
    llmCheck?: string;
    policyCheck?: string;
    approve1Check?: string;
    approve2Check?: string;
    approve3Check?: string;
  };
};

type PostResult = {
  request?: RequestResponse;
  debug?: string;
};

type RunChecksResult = {
  progress?: CheckProgress | null;
  requestId?: number;
  debug?: string;
};

/**
 * Returns whether the given check status represents an on-chain transaction phase.
 *
 * @param s - Raw check status string from the API.
 * @returns `true` if `s` is one of the on-chain transaction statuses.
 */
const isOnchainStatus = (s: string): boolean =>
  s === 'onchain_tx_processing' ||
  s === 'onchain_tx_success' ||
  s === 'onchain_tx_failed';

/**
 * Converts unknown thrown values into a safe string.
 *
 * @param error - Unknown thrown value.
 * @returns Error message text.
 */
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** `snap_manageState` key for the persisted tx-hash → request-id map. */
const TX_HASH_TO_REQUEST_ID_KEY = 'cerberus_txHashToRequestId';
/** `snap_manageState` key for the JWT session (access / refresh tokens), written by the login UI. */
const CERBERUS_SESSION_KEY = 'cerberus_session';
/** Map keys: Keccak-256 hash of RLP/hex (hex string); values: request id. */
type TxHashToRequestIdState = Record<string, number>;

type CerberusSession = {
  accessToken?: string;
  refreshToken?: string;
  user?: { email?: string; displayName?: string };
};

type CerberusState = {
  [TX_HASH_TO_REQUEST_ID_KEY]?: TxHashToRequestIdState;
  [CERBERUS_SESSION_KEY]?: CerberusSession;
};

/**
 * Reads Cerberus-related persisted state via `snap_manageState`.
 *
 * @returns Parsed Cerberus state, or `null` if unset.
 */
async function getCerberusState(): Promise<CerberusState | null> {
  const state = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' as const },
  });
  return state as CerberusState | null;
}

/**
 * Updates `snap_manageState`, merging into the current snapshot.
 * When `TX_HASH_TO_REQUEST_ID_KEY` is present in `update`, the map is replaced (not merged) so removals are applied.
 *
 * @param update - Partial state to merge or replace.
 */
async function updateCerberusState(
  update: Partial<CerberusState>,
): Promise<void> {
  const current = await getCerberusState();
  const newState: CerberusState = {
    ...current,
    ...update,
    [TX_HASH_TO_REQUEST_ID_KEY]:
      update[TX_HASH_TO_REQUEST_ID_KEY] !== undefined
        ? update[TX_HASH_TO_REQUEST_ID_KEY]
        : {
            ...(current?.[TX_HASH_TO_REQUEST_ID_KEY] ?? {}),
            ...(update[TX_HASH_TO_REQUEST_ID_KEY] ?? {}),
          },
  };
  if (update[CERBERUS_SESSION_KEY] !== undefined) {
    newState[CERBERUS_SESSION_KEY] = update[CERBERUS_SESSION_KEY];
  }
  await snap.request({
    method: 'snap_manageState',
    params: { operation: 'update' as const, newState },
  });
}

/**
 * Returns the stored access token from managed state, or `null` if not logged in.
 */
async function getStoredAccessToken(): Promise<string | null> {
  const state = await getCerberusState();
  const token = state?.[CERBERUS_SESSION_KEY]?.accessToken;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Calls `POST /auth/refresh`; on success updates managed state and returns the new access token.
 *
 * @returns New access token, or `null` on failure.
 */
async function tryRefreshSession(): Promise<string | null> {
  const state = await getCerberusState();
  const refreshToken = state?.[CERBERUS_SESSION_KEY]?.refreshToken;
  if (
    typeof refreshToken !== 'string' ||
    !refreshToken.length ||
    !REQUESTS_URL
  ) {
    return null;
  }
  try {
    const res = await fetch(`${REQUESTS_URL}/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as {
      session?: AuthSession;
    };
    if (!data?.session?.accessToken) {
      return null;
    }
    await updateCerberusState({
      [CERBERUS_SESSION_KEY]: sessionToCerberusSession(data.session),
    });
    return data.session.accessToken;
  } catch (error) {
    getErrorMessage(error);
    return null;
  }
}

/**
 * Context for the Shogun Safe home UI passed to `snap_createInterface`.
 * `fromDialog` is `true` when opened from the `showLoginScreen` RPC (dialog flow).
 */
type CerberusHomeContext =
  | { kind: 'cerberus-home'; step: 'login'; fromDialog?: boolean }
  | {
      kind: 'cerberus-home';
      step: '2fa';
      tempToken: string;
      mfaMethod?: string;
      fromDialog?: boolean;
    }
  | {
      kind: 'cerberus-home';
      step: '2fa-recovery';
      tempToken: string;
      mfaMethod?: string;
      fromDialog?: boolean;
    }
  | {
      kind: 'cerberus-home';
      step: 'logged_in';
      user?: { email?: string; displayName?: string };
      fromDialog?: boolean;
    };

/** Auth API session shape (aligned with OpenAPI). */
type AuthSession = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user?: AuthUser;
};
type AuthUser = {
  id?: string;
  email?: string;
  displayName?: string;
  role?: string;
};

/** Response from `GET /auth/2fa/status` (2FA status on the logged-in home view). */
type MfaStatus = { mfaEnabled: boolean };

/**
 * Calls `GET /auth/2fa/status` with a Bearer token and returns 2FA status, or `null` on failure.
 *
 * @param accessToken - JWT access token.
 * @returns MFA flags, or `null` if the request fails.
 */
async function fetch2faStatus(accessToken: string): Promise<MfaStatus | null> {
  if (!REQUESTS_URL) {
    return null;
  }
  try {
    const res = await fetch(`${REQUESTS_URL}/auth/2fa/status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as {
      mfaEnabled?: boolean;
    };
    return typeof data.mfaEnabled === 'boolean'
      ? { mfaEnabled: data.mfaEnabled }
      : null;
  } catch (error) {
    getErrorMessage(error);
    return null;
  }
}

/**
 * Before signing via the approval flow, stores the RLP hash → request id pair in state (merged into the existing map).
 *
 * @param rlpHex - Raw transaction RLP hex used to derive the state key.
 * @param requestId - Request id to associate with this transaction hash.
 */
async function saveTxHashRequestId(
  rlpHex: string,
  requestId: number,
): Promise<void> {
  const hash = rlpHexToKeccak256Hash(rlpHex);
  const state = await getCerberusState();
  const currentMap = state?.[TX_HASH_TO_REQUEST_ID_KEY] ?? {};
  await updateCerberusState({
    [TX_HASH_TO_REQUEST_ID_KEY]: { ...currentMap, [hash]: requestId },
  });
}

/**
 * Looks up the request id for the given RLP hex hash, removes that entry from state, and returns the id.
 *
 * @param rlpHex - Raw transaction RLP hex.
 * @returns The request id if present, otherwise `null`.
 */
async function getRequestIdByTxHashAndRemove(
  rlpHex: string,
): Promise<number | null> {
  const hash = rlpHexToKeccak256Hash(rlpHex);
  const state = await getCerberusState();
  const map = state?.[TX_HASH_TO_REQUEST_ID_KEY];
  const requestId = map?.[hash] ?? null;
  if (requestId == null || map == null) {
    return null;
  }
  const nextMap = { ...map };
  delete nextMap[hash];
  await updateCerberusState({ [TX_HASH_TO_REQUEST_ID_KEY]: nextMap });
  return requestId;
}

/**
 * Inner box content for the login form (first child of `Container`; same structure for `updateInterface` on error).
 *
 * @param errorMessage - Optional error banner text.
 * @returns Login form JSX fragment.
 */
function cerberusHomeLoginBoxContent(errorMessage?: string): JSX.Element {
  return (
    <Box>
      {errorMessage ? (
        <Banner title="Error" severity="danger">
          <Text>{errorMessage}</Text>
        </Banner>
      ) : null}
      <Heading>Shogun Safe Login</Heading>
      <Text>Please log in with your email and password.</Text>
      <Form name="cerberus-login">
        <Field label="Email">
          <Input name="email" type="text" placeholder="email@example.com" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" placeholder="••••••••" />
        </Field>
      </Form>
    </Box>
  );
}

/**
 * Home page: login form when not authenticated. The second child of `Container` must be `Footer`.
 * When `fromDialog` is true, also shows Close (footer children cannot be `null`).
 *
 * @param fromDialog - Whether the UI was opened from the login dialog RPC.
 * @returns Full login screen JSX.
 */
function renderCerberusHomeLogin(fromDialog?: boolean): JSX.Element {
  return (
    <Container>
      {cerberusHomeLoginBoxContent()}
      {fromDialog ? (
        <Footer>
          <Button name="login" variant="primary">
            Log in
          </Button>
          <Button name="close">Close</Button>
        </Footer>
      ) : (
        <Footer>
          <Button name="login" variant="primary">
            Log in
          </Button>
        </Footer>
      )}
    </Container>
  );
}

/**
 * Login screen with an error banner (for `snap_updateInterface`). `Container` has only box + footer children.
 *
 * @param errorMessage - Error text to show in the banner.
 * @param fromDialog - Whether opened from the dialog flow (adds Close when true).
 * @returns Login screen JSX with error.
 */
function renderCerberusHomeLoginWithError(
  errorMessage: string,
  fromDialog?: boolean,
): JSX.Element {
  return (
    <Container>
      {cerberusHomeLoginBoxContent(errorMessage)}
      {fromDialog ? (
        <Footer>
          <Button name="login" variant="primary">
            Log in
          </Button>
          <Button name="close">Close</Button>
        </Footer>
      ) : (
        <Footer>
          <Button name="login" variant="primary">
            Log in
          </Button>
        </Footer>
      )}
    </Container>
  );
}

/**
 * Inner box content for the 2FA code form (same structure when passing errors to `updateInterface`).
 *
 * @param mfaMethod - `totp` or other; affects helper copy.
 * @param errorMessage - Optional error banner text.
 * @returns 2FA form JSX fragment.
 */
function cerberusHome2FABoxContent(
  mfaMethod?: string,
  errorMessage?: string,
): JSX.Element {
  const methodLabel =
    mfaMethod === 'totp'
      ? '6-digit code from your authenticator app'
      : '6-digit code sent by email';
  return (
    <Box>
      {errorMessage ? (
        <Banner title="Error" severity="danger">
          <Text>{errorMessage}</Text>
        </Banner>
      ) : null}
      <Heading>2FA Verification</Heading>
      <Text>Enter the {methodLabel}.</Text>
      <Form name="cerberus-2fa">
        <Field label="Code">
          <Input name="code" type="text" placeholder="000000" />
        </Field>
      </Form>
    </Box>
  );
}

/**
 * Home page: 2FA code entry (TOTP or email code). Second child of `Container` is `Footer`.
 *
 * @param mfaMethod - MFA method hint for UI copy.
 * @returns Full 2FA screen JSX.
 */
function renderCerberusHome2FA(mfaMethod?: string): JSX.Element {
  return (
    <Container>
      {cerberusHome2FABoxContent(mfaMethod)}
      <Footer>
        <Button name="confirm" variant="primary">
          Confirm
        </Button>
        <Button name="switchToRecovery">Use recovery code</Button>
      </Footer>
    </Container>
  );
}

/**
 * 2FA screen with an error banner (for `snap_updateInterface`).
 *
 * @param mfaMethod - MFA method hint for UI copy.
 * @param errorMessage - Error text for the banner.
 * @returns 2FA screen JSX with error.
 */
function renderCerberusHome2FAWithError(
  mfaMethod?: string,
  errorMessage?: string,
): JSX.Element {
  return (
    <Container>
      {cerberusHome2FABoxContent(mfaMethod, errorMessage)}
      <Footer>
        <Button name="confirm" variant="primary">
          Confirm
        </Button>
        <Button name="switchToRecovery">Use recovery code</Button>
      </Footer>
    </Container>
  );
}

/**
 * Inner box content for the recovery-code form (same structure for error `updateInterface` calls).
 *
 * @param mfaMethod - Reserved for future MFA-specific copy (currently unused in the layout).
 * @param errorMessage - Optional error banner text.
 * @returns Recovery form JSX fragment.
 */
function cerberusHome2FARecoveryBoxContent(
  mfaMethod?: string,
  errorMessage?: string,
): JSX.Element {
  return (
    <Box>
      {errorMessage ? (
        <Banner title="Error" severity="danger">
          <Text>{errorMessage}</Text>
        </Banner>
      ) : null}
      <Heading>2FA Verification</Heading>
      <Text>Enter your recovery code to sign in.</Text>
      <Form name="cerberus-2fa-recovery">
        <Field label="Recovery code">
          <Input name="recoveryCode" type="text" placeholder="xxxxx-xxxxx" />
        </Field>
      </Form>
    </Box>
  );
}

/**
 * Home page: sign in with a recovery code.
 *
 * @param mfaMethod - MFA method hint for related flows.
 * @returns Recovery-code screen JSX.
 */
function renderCerberusHome2FARecovery(mfaMethod?: string): JSX.Element {
  return (
    <Container>
      {cerberusHome2FARecoveryBoxContent(mfaMethod)}
      <Footer>
        <Button name="confirm" variant="primary">
          Confirm
        </Button>
        <Button name="switchToAuthCode">Use auth code</Button>
      </Footer>
    </Container>
  );
}

/**
 * Recovery-code screen with an error banner (for `snap_updateInterface`).
 *
 * @param mfaMethod - MFA method hint for related flows.
 * @param errorMessage - Error text for the banner.
 * @returns Recovery screen JSX with error.
 */
function renderCerberusHome2FARecoveryWithError(
  mfaMethod?: string,
  errorMessage?: string,
): JSX.Element {
  return (
    <Container>
      {cerberusHome2FARecoveryBoxContent(mfaMethod, errorMessage)}
      <Footer>
        <Button name="confirm" variant="primary">
          Confirm
        </Button>
        <Button name="switchToAuthCode">Use auth code</Button>
      </Footer>
    </Container>
  );
}

/**
 * Home page: logged-in view (user, 2FA status, logout). When `fromDialog` is true, also shows Close.
 *
 * @param user - Optional user profile for display.
 * @param user.email - Optional email for display.
 * @param user.displayName - Optional display name.
 * @param mfaStatus - Result of `GET /auth/2fa/status`, or `null` if unknown.
 * @param fromDialog - Whether opened from the dialog flow (adds Close when true).
 * @returns Logged-in home JSX.
 */
function renderCerberusHomeLoggedIn(
  user?: { email?: string; displayName?: string },
  mfaStatus?: MfaStatus | null,
  fromDialog?: boolean,
): JSX.Element {
  const userName = user?.displayName?.trim() || user?.email?.trim() || '—';
  const twoFaSetUp = mfaStatus?.mfaEnabled === true;
  const twoFaNotSetUp = mfaStatus?.mfaEnabled === false;
  const twoFaLabel = twoFaSetUp
    ? '2FA: Set up'
    : twoFaNotSetUp
      ? '2FA: Not set up'
      : null;
  const twoFaColor: TextColors = twoFaSetUp ? 'success' : 'warning';
  return (
    <Container>
      <Box>
        <Heading>Shogun Safe</Heading>
        <Text>Logged-in user</Text>
        <Text>
          <Bold>{userName}</Bold>
        </Text>
        {twoFaLabel != null ? (
          <Text color={twoFaColor}>{twoFaLabel}</Text>
        ) : null}
        {twoFaNotSetUp ? (
          <Text>
            To use Shogun Safe Snap features, please set up two-factor
            authentication on the Shogun Safe dashboard.
          </Text>
        ) : null}
      </Box>
      {fromDialog ? (
        <Footer>
          <Button name="logout">Log out</Button>
          <Button name="close">Close</Button>
        </Footer>
      ) : (
        <Footer>
          <Button name="logout">Log out</Button>
        </Footer>
      )}
    </Container>
  );
}

/**
 * Calls `POST /auth/login` and returns either a 2FA challenge or an authenticated session.
 *
 * @param email - User email.
 * @param password - User password.
 * @returns Discriminated result: 2FA required, session, or error.
 */
async function authLogin(
  email: string,
  password: string,
): Promise<
  | { type: '2fa'; tempToken: string; mfaMethod?: string }
  | { type: 'session'; session: AuthSession }
  | { type: 'error'; message: string }
> {
  if (!REQUESTS_URL) {
    return { type: 'error', message: 'REQUESTS_URL is not configured.' };
  }
  try {
    const res = await fetch(`${REQUESTS_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        type: 'error',
        message: (data?.message as string) || `HTTP ${res.status}`,
      };
    }
    if (data.tempToken) {
      return {
        type: '2fa',
        tempToken: data.tempToken,
        mfaMethod: data.mfaMethod,
      };
    }
    if (data.session) {
      return { type: 'session', session: data.session };
    }
    return { type: 'error', message: 'Invalid response format.' };
  } catch (e) {
    return {
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Calls `POST /auth/2fa/verify` and returns a session on success.
 *
 * @param tempToken - Temporary token from the login step.
 * @param code - 2FA code entered by the user.
 * @returns Session or error result.
 */
async function auth2faVerify(
  tempToken: string,
  code: string,
): Promise<
  { type: 'session'; session: AuthSession } | { type: 'error'; message: string }
> {
  if (!REQUESTS_URL) {
    return { type: 'error', message: 'REQUESTS_URL is not configured.' };
  }
  try {
    const res = await fetch(`${REQUESTS_URL}/auth/2fa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code: code.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        type: 'error',
        message: (data?.message as string) || `HTTP ${res.status}`,
      };
    }
    if (data.session) {
      return { type: 'session', session: data.session };
    }
    return { type: 'error', message: 'Invalid response format.' };
  } catch (e) {
    return {
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Calls `POST /auth/2fa/recovery` and returns a session on success.
 *
 * @param tempToken - Temporary token from the login step.
 * @param recoveryCode - Recovery code entered by the user.
 * @returns Session or error result.
 */
async function auth2faRecovery(
  tempToken: string,
  recoveryCode: string,
): Promise<
  { type: 'session'; session: AuthSession } | { type: 'error'; message: string }
> {
  if (!REQUESTS_URL) {
    return { type: 'error', message: 'REQUESTS_URL is not configured.' };
  }
  try {
    const res = await fetch(`${REQUESTS_URL}/auth/2fa/recovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, recoveryCode: recoveryCode.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        type: 'error',
        message: (data?.message as string) || `HTTP ${res.status}`,
      };
    }
    if (data.session) {
      return { type: 'session', session: data.session };
    }
    return { type: 'error', message: 'Invalid response format.' };
  } catch (e) {
    return {
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Calls `POST /auth/logout` with a Bearer access token.
 *
 * @param accessToken - JWT access token.
 * @returns Whether the server acknowledged logout, plus optional error text.
 */
async function authLogout(
  accessToken: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!REQUESTS_URL) {
    return { ok: false, error: 'REQUESTS_URL is not configured.' };
  }
  try {
    const res = await fetch(`${REQUESTS_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 204 || res.ok) {
      return { ok: true };
    }
    const body = await res.text().catch(() => '');
    return { ok: false, error: body.slice(0, 100) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Maps an API `AuthSession` into the subset stored in `snap_manageState`.
 *
 * @param session - Session returned by the auth API.
 * @returns Persisted Cerberus session fields.
 */
function sessionToCerberusSession(session: AuthSession): CerberusSession {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: session.user
      ? { email: session.user.email, displayName: session.user.displayName }
      : undefined,
  };
}

/**
 * MetaMask home page entry: shows login or logged-in UI depending on stored session.
 *
 * @returns Interface id for the created home UI.
 */
export const onHomePage: OnHomePageHandler = async () => {
  const state = await getCerberusState();
  const session = state?.[CERBERUS_SESSION_KEY];
  const hasSession =
    typeof session?.accessToken === 'string' && session.accessToken.length > 0;

  let ui: JSX.Element;
  let context: CerberusHomeContext;

  if (hasSession && session) {
    const token = session.accessToken;
    const mfaStatus =
      typeof token === 'string' ? await fetch2faStatus(token) : null;
    ui = renderCerberusHomeLoggedIn(session.user, mfaStatus);
    context = { kind: 'cerberus-home', step: 'logged_in', user: session.user };
  } else {
    ui = renderCerberusHomeLogin();
    context = { kind: 'cerberus-home', step: 'login' };
  }

  const interfaceId = await snap.request({
    method: 'snap_createInterface',
    params: { ui, context },
  });

  return { id: interfaceId };
};

/**
 * Posts a raw transaction to `POST /snap/tx/insights` using the stored access token (with refresh on 401).
 *
 * @param payload - Raw tx and metadata for the insights API.
 * @returns Parsed request id on success, or a debug string on failure.
 */
const postRawTransaction = async (
  payload: RawTransactionPayload,
): Promise<PostResult> => {
  if (!REQUESTS_URL) {
    return { debug: 'REQUESTS_URL is empty' };
  }

  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    return {
      debug: 'Please log in to Shogun Safe in the settings.',
    };
  }

  try {
    let response = await fetch(`${REQUESTS_URL}/snap/tx/insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        rawTx: payload.rawTx,
        chain: payload.chain,
        from: payload.from ?? '',
      }),
    });

    if (response.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        response = await fetch(`${REQUESTS_URL}/snap/tx/insights`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          },
          body: JSON.stringify({
            rawTx: payload.rawTx,
            chain: payload.chain,
            from: payload.from ?? '',
          }),
        });
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        debug: `POST /snap/tx/insights status=${response.status} body=${body.slice(0, 200)}`,
      };
    }

    return { request: (await response.json()) as RequestResponse };
  } catch (error) {
    return {
      debug: `POST /snap/tx/insights failed (fetch error) url=${REQUESTS_URL} error=${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * Starts the checks pipeline for a request (`POST .../checks/start`).
 *
 * @param requestId - Cerberus request id.
 * @returns Initial check progress JSON on success, or `null` on failure.
 */
const startChecks = async (requestId: number) => {
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    return null;
  }
  const url = `${REQUESTS_URL}/snap/tx/insights/${requestId}/checks/start`;
  const bodyPayload = { payload: { request_id: String(requestId) } };
  try {
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(bodyPayload),
    });
    if (response.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          },
          body: JSON.stringify(bodyPayload),
        });
      }
    }
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as CheckProgress;
  } catch (error) {
    getErrorMessage(error);
    return null;
  }
};

type CheckFetchResult = {
  progress?: CheckProgress;
  debug?: string;
};

/** Response shape for `POST /snap/tx/insights/:id` (approved request detail). */
type RequestDetailResponse = {
  id?: number;
  transaction?: {
    rawData?: string;
    txHash?: string;
    parsed?: {
      chain?: string;
      to?: string;
      valueWei?: string;
      inputData?: string;
      gasLimit?: string;
      chainId?: string;
      maxFeePerGasGwei?: string;
      maxPriorityFeePerGasGwei?: string;
    };
  };
};

/**
 * Fetches request details with `POST /snap/tx/insights/:id` using a Bearer token (with refresh on 401).
 *
 * @param requestId - Cerberus request id.
 * @returns Parsed detail JSON, or `null` on failure.
 */
async function getRequestByIdBySnapAuth(
  requestId: number,
): Promise<RequestDetailResponse | null> {
  if (!REQUESTS_URL) {
    return null;
  }
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    return null;
  }
  const url = `${REQUESTS_URL}/snap/tx/insights/${requestId}`;
  const bodyPayload = { payload: { request_id: String(requestId) } };
  try {
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(bodyPayload),
    });
    if (response.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          },
          body: JSON.stringify(bodyPayload),
        });
      }
    }
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as RequestDetailResponse;
  } catch (error) {
    getErrorMessage(error);
    return null;
  }
}

/**
 * Calls `POST /snap/tx/insights/:requestId/post-signed` with a Bearer token after the user submits a tx hash.
 *
 * @param requestId - Cerberus request id.
 * @param transactionHash - On-chain transaction hash.
 * @returns Success flag or error message.
 */
async function postSignedTx(
  requestId: number,
  transactionHash: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!REQUESTS_URL) {
    return { ok: false, error: 'REQUESTS_URL is empty' };
  }
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      error: 'Please log in to Shogun Safe in the settings.',
    };
  }
  const url = `${REQUESTS_URL}/snap/tx/insights/${requestId}/post-signed`;
  const bodyPayload = {
    payload: {
      request_id: String(requestId),
      transaction_hash: transactionHash.trim(),
    },
  };
  try {
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(bodyPayload),
    });
    if (response.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          },
          body: JSON.stringify(bodyPayload),
        });
      }
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        error: `POST post-signed status=${response.status} ${body.slice(0, 100)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Builds `eth_sendTransaction`-style parameters from parsed Ethereum transaction fields.
 *
 * @param parsed - Parsed transaction fragment from request detail.
 * @returns Tx params for signing, or `null` if required fields are missing or chain is not Ethereum.
 */
function buildTxParamsFromParsed(
  parsed: NonNullable<RequestDetailResponse['transaction']>['parsed'],
): {
  to: string;
  value: string;
  data: string;
  gasLimit: string;
  chainId: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
} | null {
  if (!parsed?.to || parsed.chain !== 'Ethereum') {
    return null;
  }
  const valueWei = parsed.valueWei ?? '0';
  const valueHex = valueWei.startsWith('0x')
    ? valueWei
    : `0x${BigInt(valueWei).toString(16)}`;
  const gasLimitHex = parsed.gasLimit?.startsWith('0x')
    ? parsed.gasLimit
    : parsed.gasLimit
      ? `0x${BigInt(parsed.gasLimit).toString(16)}`
      : undefined;
  if (!gasLimitHex) {
    return null;
  }
  const chainId = parsed.chainId ?? '';
  const chainIdHex = chainId.startsWith('0x')
    ? chainId
    : chainId
      ? `0x${parseInt(chainId, 10).toString(16)}`
      : undefined;
  if (!chainIdHex) {
    return null;
  }
  const toAddress = parsed.to.trim();
  const toHex = toAddress.startsWith('0x') ? toAddress : `0x${toAddress}`;
  if (toHex.length !== 42) {
    return null;
  }
  /**
   * Converts a decimal Gwei string to hex wei, or `undefined` if invalid or empty.
   *
   * @param gweiStr - Gwei value as a string from parsed data.
   * @returns Hex-encoded wei, or `undefined`.
   */
  const gweiToWeiHex = (gweiStr: string | undefined): string | undefined => {
    if (gweiStr == null || gweiStr === '') {
      return undefined;
    }
    const gwei = Number(gweiStr);
    if (!Number.isFinite(gwei)) {
      return undefined;
    }
    const wei = BigInt(Math.floor(gwei * 1e9));
    return `0x${wei.toString(16)}`;
  };
  const base: {
    to: string;
    value: string;
    data: string;
    gasLimit: string;
    chainId: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  } = {
    to: toHex,
    value: valueHex,
    data: parsed.inputData?.startsWith('0x')
      ? parsed.inputData
      : `0x${parsed.inputData ?? ''}`,
    gasLimit: gasLimitHex,
    chainId: chainIdHex,
  };
  const maxFeePerGas = gweiToWeiHex(parsed.maxFeePerGasGwei);
  const maxPriorityFeePerGas = gweiToWeiHex(parsed.maxPriorityFeePerGasGwei);
  if (maxFeePerGas != null) {
    base.maxFeePerGas = maxFeePerGas;
  }
  if (maxPriorityFeePerGas != null) {
    base.maxPriorityFeePerGas = maxPriorityFeePerGas;
  }
  return base;
}

/**
 * Fetches current check progress with `POST /snap/tx/insights/:id/checks`.
 *
 * @param requestId - Cerberus request id.
 * @returns Progress payload or a debug message on failure.
 */
const getChecks = async (requestId: number): Promise<CheckFetchResult> => {
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    return {
      debug: 'Please log in to Shogun Safe in the settings.',
    };
  }

  const checksUrl = `${REQUESTS_URL}/snap/tx/insights/${requestId}/checks`;
  const bodyPayload = { payload: { request_id: String(requestId) } };
  try {
    let response = await fetch(checksUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(bodyPayload),
    });
    if (response.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        response = await fetch(checksUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          },
          body: JSON.stringify(bodyPayload),
        });
      }
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        debug: `POST /snap/tx/insights/checks status=${response.status} body=${body.slice(0, 200)}`,
      };
    }
    return { progress: (await response.json()) as CheckProgress };
  } catch (error) {
    getErrorMessage(error);
    return { debug: 'POST /snap/tx/insights/checks failed (fetch error)' };
  }
};

/**
 * Polls `getChecks` until a non-running terminal status or timeout.
 *
 * @param requestId - Cerberus request id.
 * @param timeoutMs - Max time to poll in milliseconds.
 * @param intervalMs - Delay between polls in milliseconds.
 * @returns Last non-preparation progress, a timeout marker with debug, or `null`.
 */
const pollChecks = async (
  requestId: number,
  timeoutMs = 30 * 1000,
  intervalMs = 3000,
) => {
  const startedAt = Date.now();
  let lastProgress: CheckProgress | null = null;
  let lastDebug: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await getChecks(requestId);
    const { progress } = result;
    if (result.debug) {
      lastDebug = result.debug;
    }

    if (
      progress?.status &&
      progress.status !== 'preparation' &&
      progress.status !== 'running'
    ) {
      return progress;
    }

    if (progress) {
      lastProgress = progress;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return (
    lastProgress ??
    (lastDebug
      ? ({ status: 'timeout', debug: lastDebug } as CheckProgress)
      : null)
  );
};

/**
 * Formats a wei hex string as a decimal ETH string (up to 6 fractional digits).
 *
 * @param value - Hex or decimal wei string.
 * @returns Human-readable ETH amount, or the original string on parse failure.
 */
const formatHexWeiToEth = (value?: string) => {
  if (!value) {
    return '0';
  }

  try {
    const wei = BigInt(value);
    const divisor = 10n ** 18n;
    const whole = wei / divisor;
    const fraction = wei % divisor;
    const fractionString = fraction
      .toString()
      .padStart(18, '0')
      .replace(/0+$/u, '');

    if (!fractionString) {
      return whole.toString();
    }

    return `${whole.toString()}.${fractionString.slice(0, 6)}`;
  } catch (error) {
    getErrorMessage(error);
    return value;
  }
};

/**
 * Short string preview for signature / typed-data payloads (legacy helper).
 *
 * @param data - Raw data of unknown shape.
 * @returns Truncated string or a fixed label.
 */
const formatSignatureData = (data: unknown) => {
  if (typeof data === 'string') {
    return data.length > 24 ? `${data.slice(0, 24)}…` : data;
  }

  return 'Typed data';
};

/**
 * Maps a per-check status code to a short label for the insight UI.
 *
 * @param status - Raw check status from the API.
 * @returns Display label.
 */
const formatCheckStatus = (status?: string) => {
  switch (status) {
    case 'passed':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    case 'skipped':
      return 'Skipped';
    case 'not_set':
      return 'Not set';
    case 'timeout':
      return 'Timeout';
    case 'rejected':
      return 'Rejected';
    case 'canceled':
      return 'Canceled';
    case 'approved':
      return 'Approved';
    case 'approval_pending':
      return 'Approval Pending';
    case 'error':
      return 'Error';
    case 'preparation':
      return 'Preparing';
    case 'onchain_tx_processing':
      return 'Onchain Transaction Processing';
    case 'onchain_tx_success':
      return 'Onchain Transaction Success';
    case 'onchain_tx_failed':
      return 'Onchain Transaction Failed';
    default:
      return status ?? 'Unknown';
  }
};

/**
 * Picks a Snap text color token for a check status.
 *
 * @param status - Raw check status.
 * @returns `Text` color token name.
 */
const getTextColorByCheckStatus = (status?: string): TextColors => {
  if (!status) {
    return 'default';
  }
  if (
    status === 'onchain_tx_processing' ||
    status === 'onchain_tx_success' ||
    status === 'onchain_tx_failed'
  ) {
    return 'success';
  }
  if (status === 'approved' || status === 'passed') {
    return 'success';
  }
  if (
    status === 'approval_pending' ||
    status === 'pending' ||
    status === 'running'
  ) {
    return 'warning';
  }
  if (
    status === 'rejected' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'error' ||
    status === 'timeout'
  ) {
    return 'error';
  }
  return 'default';
};

/**
 * Picks a banner severity for the aggregate check status.
 *
 * @param status - Raw aggregate check status.
 * @returns Banner severity level.
 */
const getSeverityByCheckStatus = (
  status?: string,
): 'success' | 'warning' | 'danger' | 'info' => {
  if (!status) {
    return 'info';
  }
  if (
    status === 'onchain_tx_processing' ||
    status === 'onchain_tx_success' ||
    status === 'onchain_tx_failed'
  ) {
    return 'success';
  }
  if (status === 'approved' || status === 'passed') {
    return 'success';
  }
  if (
    status === 'approval_pending' ||
    status === 'pending' ||
    status === 'running'
  ) {
    return 'warning';
  }
  if (
    status === 'rejected' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'error' ||
    status === 'timeout'
  ) {
    return 'danger';
  }
  if (status === 'error') {
    return 'danger';
  }
  return 'info';
};

const SAMPLE_ADDRESS = '0x000000000000000000000000000000000000dEaD';

type ShowcaseSummary = {
  title: string;
  fromLabel: string;
  fromValue: string;
  toLabel: string;
  toValue: string;
  valueLabel: string;
  valueValue: string;
  chainLabel: string;
  chainValue: string;
  originLabel: string;
  originValue: string;
  addressValue: string;
  amountValue: string;
  rawDataLabel?: string;
  rawDataValue?: string;
  rawDataSerializedLabel?: string;
  rawDataSerializedValue?: string;
  rawDataRlpLabel?: string;
  rawDataRlpValue?: string;
  checkStatusLabel?: string;
  checkStatusValue?: string;
  checkStatusRawValue?: string;
  signedTxHash?: string;
  igChecks?: { label: string; status?: string }[];
  egChecks?: { label: string; status?: string }[];
  vgChecks?: { label: string; status?: string }[];
  debugLabel?: string;
  debugValue?: string;
  requestId?: number;
  refreshing?: boolean;
  refreshError?: string;
  refreshSuccess?: boolean;
};

/** Mutable portion of the insight UI derived from `getChecks` (kept in context so failed refresh keeps prior values). */
type LastMutableSummary = Pick<
  ShowcaseSummary,
  | 'checkStatusLabel'
  | 'checkStatusValue'
  | 'checkStatusRawValue'
  | 'signedTxHash'
  | 'igChecks'
  | 'egChecks'
  | 'vgChecks'
  | 'debugLabel'
  | 'debugValue'
>;

/** Context for the interactive transaction insight UI; read on Refresh in `onUserInput`. */
type TxInsightContext = {
  kind: 'tx-insight';
  requestId: number;
  baseSummary: Pick<
    ShowcaseSummary,
    | 'title'
    | 'fromLabel'
    | 'fromValue'
    | 'toLabel'
    | 'toValue'
    | 'valueLabel'
    | 'valueValue'
    | 'chainLabel'
    | 'chainValue'
    | 'originLabel'
    | 'originValue'
    | 'addressValue'
    | 'amountValue'
    | 'rawDataLabel'
    | 'rawDataValue'
    | 'rawDataSerializedLabel'
    | 'rawDataSerializedValue'
    | 'rawDataRlpLabel'
    | 'rawDataRlpValue'
  >;
  lastMutableSummary?: LastMutableSummary;
};

/**
 * Builds the mutable `ShowcaseSummary` fields from a `getChecks` result (shared by refresh and first paint).
 *
 * @param checksResult - Result of `getChecks` (progress or debug).
 * @param requestId - Cerberus request id.
 * @returns Mutable summary fields plus optional `refreshError` when the fetch fails.
 */
async function buildMutableSummaryFromChecks(
  checksResult: CheckFetchResult,
  requestId: number,
): Promise<
  Pick<
    ShowcaseSummary,
    | 'checkStatusLabel'
    | 'checkStatusValue'
    | 'checkStatusRawValue'
    | 'signedTxHash'
    | 'igChecks'
    | 'egChecks'
    | 'vgChecks'
    | 'debugLabel'
    | 'debugValue'
  > & { refreshError?: string }
> {
  const debugLines: string[] = [
    `requestId=${requestId} (Refresh)`,
    `requestsUrl=${REQUESTS_URL}`,
  ];
  if (!checksResult.progress) {
    debugLines.push(`error=${checksResult.debug ?? 'getChecks failed'}`);
    return {
      checkStatusLabel: 'Check status',
      checkStatusValue: 'Refresh failed',
      checkStatusRawValue: '',
      igChecks: undefined,
      egChecks: undefined,
      vgChecks: undefined,
      debugLabel: 'Debug',
      debugValue: debugLines.join('\n'),
      refreshError: 'Could not fetch latest status. See Debug for details.',
    };
  }
  const { progress } = checksResult;
  const base = toChecksSummary(progress);
  let signedTxHash: string | undefined;
  if (isOnchainStatus(base.checkStatusRawValue)) {
    const requestDetail = await getRequestByIdBySnapAuth(requestId);
    const txHash = requestDetail?.transaction?.txHash?.trim();
    if (txHash) {
      signedTxHash = txHash;
    }
  }
  if (progress.status) {
    debugLines.push(`progressStatus=${progress.status}`);
  }
  return {
    ...base,
    signedTxHash,
    debugLabel: 'Debug',
    debugValue: debugLines.join('\n'),
  };
}

/**
 * Pretty-prints unknown transaction data for the Raw data section (JSON pretty-printed when object-like).
 *
 * @param data - Transaction or RPC payload.
 * @returns String for display.
 */
const formatRawData = (data: unknown) => {
  try {
    if (typeof data === 'string') {
      return data;
    }

    return JSON.stringify(data, null, 2);
  } catch (error) {
    getErrorMessage(error);
    return String(data);
  }
};

/**
 * Compact JSON serialization for the serialized transaction line.
 *
 * @param data - Transaction or RPC payload.
 * @returns One-line or compact JSON string.
 */
const serializeRawData = (data: unknown) => {
  try {
    if (typeof data === 'string') {
      return data;
    }

    return JSON.stringify(data);
  } catch (error) {
    getErrorMessage(error);
    return String(data);
  }
};

/**
 * Truncates a long string for debug / raw-data display.
 *
 * @param value - Input string.
 * @param maxLength - Max length before truncation.
 * @returns Truncated string with ellipsis when needed.
 */
const truncate = (value: string, maxLength = 400) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;

/**
 * Parses a CAIP-2 chain id string (e.g. `eip155:1`) into a bigint chain id.
 *
 * @param chainId - CAIP-2 chain id from MetaMask.
 * @returns Numeric chain id, or `null` if invalid.
 */
const parseCaip2ChainId = (chainId: string) => {
  const match = chainId.match(/^eip155:(\d+)$/u);
  if (!match) {
    return null;
  }

  try {
    const chainPart = match[1];
    if (!chainPart) {
      return null;
    }
    return BigInt(chainPart);
  } catch (error) {
    getErrorMessage(error);
    return null;
  }
};

/**
 * Safely parses an optional hex/decimal string to `bigint`.
 *
 * @param value - Hex or decimal string (optional).
 * @returns bigint or `undefined` if missing or invalid.
 */
const toBigInt = (value?: string) => {
  if (!value) {
    return undefined;
  }

  try {
    return BigInt(value);
  } catch (error) {
    getErrorMessage(error);
    return undefined;
  }
};

/**
 * Type guard: transaction includes EIP-1559 fee fields.
 *
 * @param tx - Transaction from the Snap SDK.
 * @returns Whether `tx` is EIP-1559-shaped.
 */
const isEip1559Transaction = (
  tx: Transaction,
): tx is Transaction & { maxFeePerGas: string; maxPriorityFeePerGas: string } =>
  'maxFeePerGas' in tx && 'maxPriorityFeePerGas' in tx;

/**
 * Serializes a transaction to a hex RLP string for hashing and API calls.
 *
 * @param transaction - Transaction from MetaMask.
 * @param chainId - CAIP-2 chain id string.
 * @returns Serialized RLP hex, or `null` on failure.
 */
const serializeTransactionRlp = (transaction: Transaction, chainId: string) => {
  try {
    const parsedChainId = parseCaip2ChainId(chainId);
    const common = parsedChainId
      ? Common.custom({ chainId: Number(parsedChainId) })
      : undefined;
    const txOptions = common ? { common } : undefined;
    const baseTxData = {
      nonce: toBigInt(transaction.nonce),
      gasLimit: toBigInt(transaction.gas),
      to: transaction.to ?? undefined,
      value: toBigInt(transaction.value),
      data: transaction.data ?? '0x',
    };

    const tx = isEip1559Transaction(transaction)
      ? TransactionFactory.fromTxData(
          {
            type: 2,
            chainId: parsedChainId ?? undefined,
            maxPriorityFeePerGas: toBigInt(transaction.maxPriorityFeePerGas),
            maxFeePerGas: toBigInt(transaction.maxFeePerGas),
            accessList: [],
            ...baseTxData,
          },
          txOptions,
        )
      : TransactionFactory.fromTxData(
          {
            type: 0,
            gasPrice: toBigInt(transaction.gasPrice),
            ...baseTxData,
          },
          txOptions,
        );

    return bufferToHex(tx.serialize());
  } catch (error) {
    getErrorMessage(error);
    return null;
  }
};

/**
 * Insight shown when the user is not logged in (does not call `postRawTransaction`; prompts to open settings).
 *
 * @returns JSX instructing the user to log in via the Snap settings home page.
 */
function renderNotLoggedInInsight(): JSX.Element {
  return (
    <Box>
      <Heading size="lg">Please log in to Shogun Safe</Heading>
      <Banner title="Notice" severity="warning">
        <Text>
          You need to log in to Shogun Safe in the settings to verify this
          transaction.
        </Text>
        <Text>
          Open the <Bold>Snaps</Bold> menu in MetaMask, select{' '}
          <Bold>Shogun Safe</Bold>, and log in with your email and password on
          the settings (Home) page.
        </Text>
      </Banner>
    </Box>
  );
}

/**
 * Renders the main transaction insight “showcase” panel (summary, checks, refresh, debug).
 *
 * @param summary - Aggregated fields to display.
 * @returns JSX tree for the insight UI.
 */
const renderShowcase = (summary: ShowcaseSummary) => (
  <Box>
    <Heading size="lg">{summary.title}</Heading>
    {summary.requestId != null && summary.requestId > 0 ? (
      <Section>
        <Button name="refresh" disabled={summary.refreshing}>
          {summary.refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Section>
    ) : null}
    {summary.refreshError ? (
      <Banner title="Refresh failed" severity="danger">
        <Text>
          <Bold>{summary.refreshError}</Bold>
        </Text>
      </Banner>
    ) : null}
    {summary.refreshSuccess ? (
      <Banner title="Refresh success" severity="success">
        <Text>
          <Bold>Latest status has been loaded.</Bold>
        </Text>
      </Banner>
    ) : null}
    {summary.signedTxHash ? (
      <Banner title="NOTICE" severity="warning">
        <Text>
          <Bold>This request&apos;s transaction has been signed.</Bold>
        </Text>
        <Text>
          <Bold>TxHash: {summary.signedTxHash}</Bold>
        </Text>
        <Text>
          <Bold>
            Please check the result on the dashboard or block chain explorer.
          </Bold>
        </Text>
      </Banner>
    ) : null}
    {summary.checkStatusValue ? (
      <Banner
        title={summary.checkStatusLabel ?? 'Check status'}
        severity={getSeverityByCheckStatus(summary.checkStatusRawValue)}
      >
        <Text>
          <Bold>{summary.checkStatusValue}</Bold>
        </Text>
      </Banner>
    ) : null}
    {summary.igChecks && summary.igChecks.length > 0 ? (
      <Section>
        <Heading size="sm">IG check</Heading>
        {summary.igChecks.map((item) => (
          <Row key={`ig-${item.label}`} label={item.label}>
            <Text color={getTextColorByCheckStatus(item.status)}>
              {formatCheckStatus(item.status)}
            </Text>
          </Row>
        ))}
      </Section>
    ) : null}
    {summary.egChecks && summary.egChecks.length > 0 ? (
      <Section>
        <Heading size="sm">EG check</Heading>
        {summary.egChecks.map((item) => (
          <Row key={`eg-${item.label}`} label={item.label}>
            <Text color={getTextColorByCheckStatus(item.status)}>
              {formatCheckStatus(item.status)}
            </Text>
          </Row>
        ))}
      </Section>
    ) : null}
    {summary.vgChecks && summary.vgChecks.length > 0 ? (
      <Section>
        <Heading size="sm">VG check</Heading>
        {summary.vgChecks.map((item) => (
          <Row key={`vg-${item.label}`} label={item.label}>
            <Text color={getTextColorByCheckStatus(item.status)}>
              {formatCheckStatus(item.status)}
            </Text>
          </Row>
        ))}
      </Section>
    ) : null}
    {summary.debugValue ? (
      <Section>
        <Heading size="sm">{summary.debugLabel ?? 'Debug'}</Heading>
        <Text>{summary.debugValue}</Text>
      </Section>
    ) : null}
    {summary.rawDataValue ||
    summary.rawDataSerializedValue ||
    summary.rawDataRlpValue ? (
      <Section>
        <Heading size="sm">{summary.rawDataLabel ?? 'Raw data'}</Heading>
        {summary.rawDataValue ? <Text>{summary.rawDataValue}</Text> : null}
        {summary.rawDataSerializedValue ? (
          <Text>
            {summary.rawDataSerializedLabel ?? 'Serialized'}:{' '}
            {summary.rawDataSerializedValue}
          </Text>
        ) : null}
        {summary.rawDataRlpValue ? (
          <Text>
            {summary.rawDataRlpLabel ?? 'RLP/hex'}: {summary.rawDataRlpValue}
          </Text>
        ) : null}
      </Section>
    ) : null}
  </Box>
);

/**
 * MetaMask transaction insight hook: runs checks, builds the showcase UI, and stores refresh context.
 *
 * @param args - Handler arguments from the Snap runtime.
 * @param args.transaction - Pending transaction.
 * @param args.chainId - CAIP-2 chain id.
 * @param args.transactionOrigin - Originating site URL when available.
 * @returns Interface id and severity for the insight panel.
 */
export const onTransaction: OnTransactionHandler = async ({
  transaction,
  chainId,
  transactionOrigin,
}) => {
  const formattedValue = formatHexWeiToEth(transaction.value ?? '0x0');
  const recipient = transaction.to ?? 'Contract creation';
  const rlpHex = serializeTransactionRlp(transaction, chainId);
  let checkStatusText = 'Unverified';
  let checkStatusRawValue = '';
  let signedTxHash: string | undefined;
  let requestId = 0;
  let debugText = '';
  const debugLines: string[] = [];
  let igChecks: ShowcaseSummary['igChecks'];
  let egChecks: ShowcaseSummary['egChecks'];
  let vgChecks: ShowcaseSummary['vgChecks'];

  if (rlpHex) {
    const accessToken = await getStoredAccessToken();
    if (!accessToken) {
      const interfaceId = await snap.request({
        method: 'snap_createInterface',
        params: { ui: renderNotLoggedInInsight() },
      });
      return {
        id: interfaceId,
        severity: SeverityLevel.Critical,
      };
    }

    const approvedRequestId = await getRequestIdByTxHashAndRemove(rlpHex);

    if (approvedRequestId != null) {
      requestId = approvedRequestId;
      const checksResult = await getChecks(approvedRequestId);
      if (checksResult?.progress) {
        const checksPart = toChecksSummary(checksResult.progress);
        checkStatusText = checksPart.checkStatusValue;
        checkStatusRawValue = checksPart.checkStatusRawValue;
        igChecks = checksPart.igChecks;
        egChecks = checksPart.egChecks;
        vgChecks = checksPart.vgChecks;
        if (isOnchainStatus(checksPart.checkStatusRawValue)) {
          const requestDetail =
            await getRequestByIdBySnapAuth(approvedRequestId);
          const txHash = requestDetail?.transaction?.txHash?.trim();
          if (txHash) {
            signedTxHash = txHash;
          }
        }
      }
      debugLines.push(`requestId=${approvedRequestId} (Approved)`);
      debugLines.push(`requestsUrl=${REQUESTS_URL}`);
      if (checksResult?.progress?.status) {
        debugLines.push(`progressStatus=${checksResult.progress.status}`);
      }
    } else {
      /**
       * Submits raw tx, starts checks, and polls until completion or timeout.
       *
       * @returns Progress and request id, or a debug-only object on failure.
       */
      const runChecks = async () => {
        const result = await postRawTransaction({
          rawTx: rlpHex,
          chain: 'Ethereum',
          from: transaction.from ?? '',
          origin: transactionOrigin ?? '',
          timestamp: Math.floor(Date.now() / 1000),
        });

        if (!result.request?.id) {
          return {
            debug: result.debug ?? 'POST /snap/tx/insights failed (no id)',
          };
        }

        await startChecks(result.request.id);
        const progress = await pollChecks(result.request.id);
        return { progress, requestId: result.request.id };
      };

      const result: RunChecksResult = await runChecks().catch((error) => ({
        debug: `POST /snap/tx/insights error: ${error instanceof Error ? error.message : String(error)}`,
      }));
      requestId = result?.requestId ?? 0;

      if (result?.progress) {
        const checksPart = toChecksSummary(result.progress);
        checkStatusText = checksPart.checkStatusValue;
        checkStatusRawValue = checksPart.checkStatusRawValue;
        igChecks = checksPart.igChecks;
        egChecks = checksPart.egChecks;
        vgChecks = checksPart.vgChecks;
      } else if (result?.requestId) {
        checkStatusText = formatSummaryStatus('timeout');
        checkStatusRawValue = 'timeout';
      }

      if (result?.requestId) {
        debugLines.push(`requestId=${result.requestId}`);
      }
      debugLines.push(`requestsUrl=${REQUESTS_URL}`);
      if (result?.progress?.status) {
        debugLines.push(`progressStatus=${result.progress.status}`);
      }
      if (result?.progress?.checks) {
        debugLines.push(
          `checks=${truncate(JSON.stringify(result.progress.checks), 200)}`,
        );
      }
      if (result?.progress && 'debug' in result.progress) {
        debugLines.push(
          `pollError=${(result.progress as { debug?: string }).debug}`,
        );
      }
      if (result?.debug) {
        debugLines.push(`error=${result.debug}`);
      }
    }
  }
  debugText = debugLines.join('\n');

  const summary: ShowcaseSummary = {
    title: `Transaction summary (Request #${requestId})`,
    fromLabel: 'From',
    fromValue: transaction.from,
    toLabel: 'To',
    toValue: recipient,
    valueLabel: 'Value',
    valueValue: `${formattedValue} ETH`,
    chainLabel: 'Network',
    chainValue: chainId,
    originLabel: 'Submitted by',
    originValue: transactionOrigin ?? 'Unknown application',
    addressValue: transaction.to ?? SAMPLE_ADDRESS,
    amountValue: `${formattedValue} ETH`,
    checkStatusLabel: 'Check status',
    checkStatusValue: checkStatusText,
    checkStatusRawValue,
    signedTxHash,
    igChecks,
    egChecks,
    vgChecks,
    debugLabel: 'Debug',
    debugValue: debugText,
    rawDataLabel: 'Raw transaction',
    rawDataValue: truncate(formatRawData(transaction)),
    rawDataSerializedLabel: 'Serialized transaction',
    rawDataSerializedValue: truncate(serializeRawData(transaction)),
    rawDataRlpLabel: 'RLP/hex',
    rawDataRlpValue: rlpHex ?? undefined,
    requestId,
  };

  const lastMutableSummary: LastMutableSummary = {
    checkStatusLabel: summary.checkStatusLabel,
    checkStatusValue: summary.checkStatusValue,
    checkStatusRawValue: summary.checkStatusRawValue,
    signedTxHash: summary.signedTxHash,
    igChecks: summary.igChecks,
    egChecks: summary.egChecks,
    vgChecks: summary.vgChecks,
    debugLabel: summary.debugLabel,
    debugValue: summary.debugValue,
  };

  const context: TxInsightContext = {
    kind: 'tx-insight',
    requestId,
    baseSummary: {
      title: summary.title,
      fromLabel: summary.fromLabel,
      fromValue: summary.fromValue,
      toLabel: summary.toLabel,
      toValue: summary.toValue,
      valueLabel: summary.valueLabel,
      valueValue: summary.valueValue,
      chainLabel: summary.chainLabel,
      chainValue: summary.chainValue,
      originLabel: summary.originLabel,
      originValue: summary.originValue,
      addressValue: summary.addressValue,
      amountValue: summary.amountValue,
      rawDataLabel: summary.rawDataLabel,
      rawDataValue: summary.rawDataValue,
      rawDataSerializedLabel: summary.rawDataSerializedLabel,
      rawDataSerializedValue: summary.rawDataSerializedValue,
      rawDataRlpLabel: summary.rawDataRlpLabel,
      rawDataRlpValue: summary.rawDataRlpValue,
    },
    lastMutableSummary,
  };

  const interfaceId = await snap.request({
    method: 'snap_createInterface',
    params: {
      ui: renderShowcase(summary),
      context,
    },
  });

  return {
    id: interfaceId,
    severity: SeverityLevel.Critical,
  };
};

/**
 * Handles button clicks on interactive interfaces (Cerberus home flows and tx insight refresh).
 *
 * @param args - User input event payload from the Snap runtime.
 * @param args.id - Interface id.
 * @param args.event - Button click or other input event.
 */
export const onUserInput: OnUserInputHandler = async ({ id, event }) => {
  if (event.type !== UserInputEventType.ButtonClickEvent) {
    return;
  }

  const ctx = await snap.request({
    method: 'snap_getInterfaceContext',
    params: { id },
  });
  const homeCtx = ctx as CerberusHomeContext | null;
  if (homeCtx?.kind === 'cerberus-home') {
    if (event.name === 'close' && homeCtx.fromDialog) {
      const value = homeCtx.step === 'logged_in';
      await snap.request({
        method: 'snap_resolveInterface',
        params: { id, value },
      });
      return;
    }
    if (homeCtx.step === 'login' && event.name === 'login') {
      const state = (await snap.request({
        method: 'snap_getInterfaceState',
        params: { id },
      })) as Record<string, unknown> | null;
      const formState =
        state != null &&
        typeof state['cerberus-login'] === 'object' &&
        state['cerberus-login'] != null
          ? (state['cerberus-login'] as Record<string, unknown>)
          : state;
      const email = typeof formState?.email === 'string' ? formState.email : '';
      const password =
        typeof formState?.password === 'string' ? formState.password : '';
      if (!email.trim()) {
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHomeLoginWithError(
              'Please enter your email.',
              homeCtx.fromDialog,
            ),
          },
        });
        return;
      }
      const result = await authLogin(email, password);
      if (result.type === '2fa') {
        const newCtx: CerberusHomeContext = {
          kind: 'cerberus-home',
          step: '2fa',
          tempToken: result.tempToken,
          mfaMethod: result.mfaMethod,
          fromDialog: homeCtx.fromDialog,
        };
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHome2FA(result.mfaMethod),
            context: newCtx,
          },
        });
        return;
      }
      if (result.type === 'session') {
        await updateCerberusState({
          [CERBERUS_SESSION_KEY]: sessionToCerberusSession(result.session),
        });
        const mfaStatus = await fetch2faStatus(result.session.accessToken);
        const newCtx: CerberusHomeContext = {
          kind: 'cerberus-home',
          step: 'logged_in',
          user: result.session.user
            ? {
                email: result.session.user.email,
                displayName: result.session.user.displayName,
              }
            : undefined,
          fromDialog: homeCtx.fromDialog,
        };
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHomeLoggedIn(
              newCtx.user,
              mfaStatus,
              newCtx.fromDialog,
            ),
            context: newCtx,
          },
        });
        return;
      }
      await snap.request({
        method: 'snap_updateInterface',
        params: {
          id,
          ui: renderCerberusHomeLoginWithError(
            result.message,
            homeCtx.fromDialog,
          ),
        },
      });
      return;
    }
    if (homeCtx.step === '2fa' && event.name === 'switchToRecovery') {
      const newCtx: CerberusHomeContext = {
        kind: 'cerberus-home',
        step: '2fa-recovery',
        tempToken: homeCtx.tempToken,
        mfaMethod: homeCtx.mfaMethod,
        fromDialog: homeCtx.fromDialog,
      };
      await snap.request({
        method: 'snap_updateInterface',
        params: {
          id,
          ui: renderCerberusHome2FARecovery(homeCtx.mfaMethod),
          context: newCtx,
        },
      });
      return;
    }
    if (homeCtx.step === '2fa' && event.name === 'confirm') {
      const state = (await snap.request({
        method: 'snap_getInterfaceState',
        params: { id },
      })) as Record<string, unknown> | null;
      const formState2fa =
        state != null &&
        typeof state['cerberus-2fa'] === 'object' &&
        state['cerberus-2fa'] != null
          ? (state['cerberus-2fa'] as Record<string, unknown>)
          : state;
      const code =
        typeof formState2fa?.code === 'string' ? formState2fa.code : '';
      const result = await auth2faVerify(homeCtx.tempToken, code);
      if (result.type === 'session') {
        await updateCerberusState({
          [CERBERUS_SESSION_KEY]: sessionToCerberusSession(result.session),
        });
        const mfaStatus = await fetch2faStatus(result.session.accessToken);
        const newCtx: CerberusHomeContext = {
          kind: 'cerberus-home',
          step: 'logged_in',
          user: result.session.user
            ? {
                email: result.session.user.email,
                displayName: result.session.user.displayName,
              }
            : undefined,
          fromDialog: homeCtx.fromDialog,
        };
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHomeLoggedIn(
              newCtx.user,
              mfaStatus,
              newCtx.fromDialog,
            ),
            context: newCtx,
          },
        });
        return;
      }
      await snap.request({
        method: 'snap_updateInterface',
        params: {
          id,
          ui: renderCerberusHome2FAWithError(homeCtx.mfaMethod, result.message),
        },
      });
      return;
    }
    if (homeCtx.step === '2fa-recovery' && event.name === 'switchToAuthCode') {
      const newCtx: CerberusHomeContext = {
        kind: 'cerberus-home',
        step: '2fa',
        tempToken: homeCtx.tempToken,
        mfaMethod: homeCtx.mfaMethod,
        fromDialog: homeCtx.fromDialog,
      };
      await snap.request({
        method: 'snap_updateInterface',
        params: {
          id,
          ui: renderCerberusHome2FA(homeCtx.mfaMethod),
          context: newCtx,
        },
      });
      return;
    }
    if (homeCtx.step === '2fa-recovery' && event.name === 'confirm') {
      const state = (await snap.request({
        method: 'snap_getInterfaceState',
        params: { id },
      })) as Record<string, unknown> | null;
      const formStateRecovery =
        state != null &&
        typeof state['cerberus-2fa-recovery'] === 'object' &&
        state['cerberus-2fa-recovery'] != null
          ? (state['cerberus-2fa-recovery'] as Record<string, unknown>)
          : state;
      const recoveryCode =
        typeof formStateRecovery?.recoveryCode === 'string'
          ? formStateRecovery.recoveryCode
          : '';
      const result = await auth2faRecovery(homeCtx.tempToken, recoveryCode);
      if (result.type === 'session') {
        await updateCerberusState({
          [CERBERUS_SESSION_KEY]: sessionToCerberusSession(result.session),
        });
        const mfaStatus = await fetch2faStatus(result.session.accessToken);
        const newCtx: CerberusHomeContext = {
          kind: 'cerberus-home',
          step: 'logged_in',
          user: result.session.user
            ? {
                email: result.session.user.email,
                displayName: result.session.user.displayName,
              }
            : undefined,
          fromDialog: homeCtx.fromDialog,
        };
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHomeLoggedIn(
              newCtx.user,
              mfaStatus,
              newCtx.fromDialog,
            ),
            context: newCtx,
          },
        });
        return;
      }
      await snap.request({
        method: 'snap_updateInterface',
        params: {
          id,
          ui: renderCerberusHome2FARecoveryWithError(
            homeCtx.mfaMethod,
            result.message,
          ),
        },
      });
      return;
    }
    if (homeCtx.step === 'logged_in' && event.name === 'logout') {
      const accessToken = await getStoredAccessToken();
      if (!accessToken) {
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHomeLogin(),
            context: {
              kind: 'cerberus-home',
              step: 'login',
            } as CerberusHomeContext,
          },
        });
        return;
      }
      const logoutResult = await authLogout(accessToken);
      await updateCerberusState({ [CERBERUS_SESSION_KEY]: undefined });
      const newCtx: CerberusHomeContext = {
        kind: 'cerberus-home',
        step: 'login',
        fromDialog: homeCtx.fromDialog,
      };
      if (logoutResult.ok) {
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHomeLogin(homeCtx.fromDialog),
            context: newCtx,
          },
        });
      } else {
        await snap.request({
          method: 'snap_updateInterface',
          params: {
            id,
            ui: renderCerberusHomeLoginWithError(
              `Logout error: ${logoutResult.error ?? ''}`,
              homeCtx.fromDialog,
            ),
            context: newCtx,
          },
        });
      }
      return;
    }
    return;
  }

  if (event.name === 'refresh') {
    const context = ctx as TxInsightContext | null;
    if (context?.kind !== 'tx-insight' || context.requestId <= 0) {
      return;
    }
    const { baseSummary, requestId, lastMutableSummary } = context;

    // While refreshing: keep last mutable content; only the button shows "Refreshing...".
    const refreshingSummary: ShowcaseSummary = {
      ...baseSummary,
      ...(lastMutableSummary ?? {}),
      requestId,
      refreshing: true,
    };
    await snap.request({
      method: 'snap_updateInterface',
      params: { id, ui: renderShowcase(refreshingSummary) },
    });

    let mutable: Pick<
      ShowcaseSummary,
      | 'checkStatusLabel'
      | 'checkStatusValue'
      | 'checkStatusRawValue'
      | 'signedTxHash'
      | 'igChecks'
      | 'egChecks'
      | 'vgChecks'
      | 'debugLabel'
      | 'debugValue'
    > & { refreshError?: string };
    try {
      const checksResult = await getChecks(requestId);
      mutable = await buildMutableSummaryFromChecks(checksResult, requestId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      mutable = {
        checkStatusLabel: 'Check status',
        checkStatusValue: 'Refresh failed',
        checkStatusRawValue: '',
        igChecks: undefined,
        egChecks: undefined,
        vgChecks: undefined,
        debugLabel: 'Debug',
        debugValue: [
          `requestId=${requestId} (Refresh)`,
          `requestsUrl=${REQUESTS_URL}`,
          `error=${errMsg}`,
        ].join('\n'),
        refreshError: 'Refresh failed. See Debug for details.',
      };
    }

    const success = !mutable.refreshError;
    if (success) {
      const updatedSummary: ShowcaseSummary = {
        ...baseSummary,
        ...mutable,
        requestId,
        refreshing: false,
        refreshSuccess: true,
      };
      const newContext: TxInsightContext = {
        ...context,
        lastMutableSummary: {
          checkStatusLabel: mutable.checkStatusLabel,
          checkStatusValue: mutable.checkStatusValue,
          checkStatusRawValue: mutable.checkStatusRawValue,
          signedTxHash: mutable.signedTxHash,
          igChecks: mutable.igChecks,
          egChecks: mutable.egChecks,
          vgChecks: mutable.vgChecks,
          debugLabel: mutable.debugLabel,
          debugValue: mutable.debugValue,
        },
      };
      await snap.request({
        method: 'snap_updateInterface',
        params: { id, ui: renderShowcase(updatedSummary), context: newContext },
      });
    } else {
      const failedSummary: ShowcaseSummary = {
        ...baseSummary,
        ...(lastMutableSummary ?? {}),
        requestId,
        refreshing: false,
        refreshError: mutable.refreshError,
      };
      await snap.request({
        method: 'snap_updateInterface',
        params: { id, ui: renderShowcase(failedSummary) },
      });
    }
    return;
  }

  if (event.name !== 'cancel' && event.name !== 'confirm') {
    return;
  }

  await snap.request({
    method: 'snap_resolveInterface',
    params: {
      id,
      value: event.name === 'confirm',
    },
  });
};

/**
 * Handles JSON-RPC methods invoked via `wallet_invokeSnap` (login dialog, post-signed tx, sign-approved tx).
 *
 * @param args - RPC handler arguments.
 * @param args.request - JSON-RPC request object.
 * @returns Method-specific result (e.g. dialog outcome or tx params).
 * @throws If the method is missing, invalid, or prerequisites fail.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  switch (request.method) {
    case 'showLoginScreen': {
      const state = await getCerberusState();
      const session = state?.[CERBERUS_SESSION_KEY];
      const hasSession =
        typeof session?.accessToken === 'string' &&
        session.accessToken.length > 0;
      let ui: JSX.Element;
      let context: CerberusHomeContext;
      if (hasSession && session) {
        const token = session.accessToken;
        const mfaStatus =
          typeof token === 'string' ? await fetch2faStatus(token) : null;
        ui = renderCerberusHomeLoggedIn(session.user, mfaStatus, true);
        context = {
          kind: 'cerberus-home',
          step: 'logged_in',
          user: session.user,
          fromDialog: true,
        };
      } else {
        ui = renderCerberusHomeLogin(true);
        context = { kind: 'cerberus-home', step: 'login', fromDialog: true };
      }
      const interfaceId = await snap.request({
        method: 'snap_createInterface',
        params: { ui, context },
      });
      return snap.request({
        method: 'snap_dialog',
        params: { id: interfaceId },
      });
    }
    case 'post-signed-tx': {
      const params = request.params as
        | {
            requestId?: number;
            transactionHash?: string;
          }
        | undefined;
      const requestId =
        typeof params?.requestId === 'number' ? params.requestId : undefined;
      const transactionHash =
        typeof params?.transactionHash === 'string'
          ? params.transactionHash
          : '';
      if (requestId == null || !transactionHash.trim()) {
        throw new Error(
          'post-signed-tx: requestId and transactionHash are required',
        );
      }
      return postSignedTx(requestId, transactionHash);
    }
    case 'sign-approved-tx': {
      const params = request.params as { requestId?: number } | undefined;
      const requestId =
        typeof params?.requestId === 'number' ? params.requestId : undefined;
      if (requestId == null) {
        throw new Error('sign-approved-tx: requestId is required');
      }
      const accessToken = await getStoredAccessToken();
      if (!accessToken) {
        throw new Error(
          'Please log in to Shogun Safe. Open the Snaps menu in MetaMask, select Shogun Safe, and log in on the settings page.',
        );
      }
      const requestDetail = await getRequestByIdBySnapAuth(requestId);
      if (!requestDetail?.transaction?.rawData) {
        throw new Error(
          'sign-approved-tx: failed to get request or missing transaction.rawData',
        );
      }
      const { rawData } = requestDetail.transaction;
      await saveTxHashRequestId(rawData, requestId);
      const { parsed } = requestDetail.transaction;
      const txParams = buildTxParamsFromParsed(parsed);
      if (!txParams) {
        throw new Error(
          'sign-approved-tx: could not build tx params (Ethereum parsed data required)',
        );
      }
      return { txParams };
    }
    default:
      throw new Error('Method not found.');
  }
};
