import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { setRuntimeCurrency } from '../utils/currencyRuntime';
import { clearUserData } from '../stores/clearUserData';
import { tr } from '../i18n/runtime';
import toast from 'react-hot-toast';

const AuthContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);

  useEffect(() => {
    // Enlace de recuperación vencido o ya usado: Supabase redirige con el error
    // en el hash (#error=access_denied&error_code=otp_expired&...) con el flujo
    // implícito, o en la query (?error_code=...) con PKCE. Sin esto el usuario
    // aterriza en la landing sin ninguna explicación.
    const errorSource = [window.location.hash.slice(1), window.location.search.slice(1)]
      .find((s) => s.includes('error_code='));
    if (errorSource) {
      const params = new URLSearchParams(errorSource);
      const code = params.get('error_code') || '';
      const msg = code === 'otp_expired'
        ? tr('auth.resetLinkExpired', 'El enlace ya venció o fue usado. Pide uno nuevo desde "¿Olvidaste tu contraseña?".')
        : params.get('error_description') || code;
      toast.error(msg, { duration: 8000 });
      window.history.replaceState(null, '', window.location.pathname);
    }

    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        setSession(session);
        setUser(session?.user || null);
      } catch (error) {
        console.error('Error getting session:', error.message);
      } finally {
        // El intercambio PKCE ya consumió el ?code= del callback OAuth, pero
        // supabase-js no lo quita de la URL; sin esto queda un query param
        // muerto (y un enlace que falla si se comparte/recarga).
        const url = new URL(window.location.href);
        if (url.searchParams.has('code')) {
          url.searchParams.delete('code');
          window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
        }
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user || null);
        
        if (event === 'PASSWORD_RECOVERY') {
          setIsRecoveringPassword(true);
        }

        // Limpiar datos del usuario en CUALQUIER fin de sesión (signOut manual,
        // token expirado, cierre desde otra pestaña). Si quedara estado en
        // memoria o caché, otra persona que inicie sesión en esta misma pestaña
        // vería las finanzas del usuario anterior.
        if (event === 'SIGNED_OUT') {
          setRuntimeCurrency(null);
          clearUserData();
        }

        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      }
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setIsRecoveringPassword(false);
    // La limpieza de datos (stores en memoria + caché de sessionStorage +
    // moneda runtime) corre en el handler del evento SIGNED_OUT, que también
    // cubre expiración de token y cierre desde otra pestaña.
    toast.success(tr('stores.auth.signedOut'));
  };

  const resetPassword = async (email) => {
    // Redirige usando el origen actual (ya sea localhost o vercel)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) throw error;
  };

  const updatePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setIsRecoveringPassword(false);
  };

  const value = {
    session,
    user,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword,
    isRecoveringPassword,
    setIsRecoveringPassword,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
