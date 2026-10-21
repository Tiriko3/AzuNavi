// Adresse der Download-Seite (Releases) mit der neuesten Version. Wird beim Bauen der Web-App von der Pipeline gesetzt.
export const DOWNLOAD_URL: string | undefined = (import.meta.env.VITE_DOWNLOAD_URL as string | undefined) || undefined;
