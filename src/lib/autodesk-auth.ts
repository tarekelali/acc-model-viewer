import { supabase } from "@/integrations/supabase/client";

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
}

const TOKEN_STORAGE_KEY = 'autodesk_tokens';

export const saveTokens = (
  accessToken: string, 
  refreshToken: string, 
  expiresIn: number
) => {
  const expiresAt = Date.now() + (expiresIn * 1000);
  const tokenData: TokenData = {
    accessToken,
    refreshToken,
    expiresAt,
  };
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenData));
  console.log('Tokens saved, expires at:', new Date(expiresAt));
};

export const getTokens = (): TokenData | null => {
  const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

export const clearTokens = () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  // Also clear legacy token
  localStorage.removeItem('autodesk_token');
  console.log('Tokens cleared');
};

export const isTokenExpired = (tokenData: TokenData): boolean => {
  // Consider expired if less than 5 minutes remaining
  const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
  return Date.now() >= (tokenData.expiresAt - bufferTime);
};

export const refreshAccessToken = async (
  refreshToken: string
): Promise<TokenData | null> => {
  try {
    console.log('Attempting to refresh access token...');
    
    const { data, error } = await supabase.functions.invoke('autodesk-refresh-token', {
      body: { refreshToken },
    });

    if (error) {
      console.error('Token refresh failed:', error);
      return null;
    }

    if (!data.access_token) {
      console.error('No access token in response');
      return null;
    }

    console.log('Token refresh successful');
    
    // Save the new tokens
    saveTokens(data.access_token, data.refresh_token, data.expires_in);
    
    return getTokens();
  } catch (error) {
    console.error('Refresh token error:', error);
    return null;
  }
};

export const getValidAccessToken = async (): Promise<string | null> => {
  const tokens = getTokens();
  
  if (!tokens) {
    console.log('No tokens found in storage');
    return null;
  }

  // If token is still valid, return it
  if (!isTokenExpired(tokens)) {
    console.log('Access token still valid');
    return tokens.accessToken;
  }

  // Token expired, try to refresh
  console.log('Access token expired, refreshing...');
  const newTokens = await refreshAccessToken(tokens.refreshToken);
  
  if (!newTokens) {
    console.log('Refresh failed, clearing tokens');
    clearTokens();
    return null;
  }

  return newTokens.accessToken;
};

export const startAuthFlow = () => {
  const authUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/autodesk-auth`;
  console.log('Starting Autodesk auth flow...');
  window.location.href = authUrl;
};
