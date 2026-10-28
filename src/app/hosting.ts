/** Static deployments host solo play; the LAN lobby needs the local Vite server. */
export const STATIC_HOST = import.meta.env.VITE_STATIC_HOST === 'true';
