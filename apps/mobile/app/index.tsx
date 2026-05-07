import { Redirect } from 'expo-router';

/**
 * Entry route. For Phase 1 we always go to /connect — there's no auth state
 * to check yet. Phase 2 introduces the secure-store reauthorize check and
 * redirects to /(tabs)/hearth on success.
 */
export default function Index() {
  return <Redirect href="/connect" />;
}
