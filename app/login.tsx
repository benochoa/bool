import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { supabase } from '@/supabaseClient';

export default function LoginScreen() {
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSendCode() {
    setError('');
    if (!phone.trim().startsWith('+')) {
      setError('Include country code, e.g. +15551234567');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: phone.trim() });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStage('code');
  }

  async function handleVerifyCode() {
    setError('');
    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phone.trim(),
      token: code.trim(),
      type: 'sms',
    });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    // Ensure a profile row exists for first-time logins; no-op otherwise.
    if (data.user) {
      await supabase.from('profiles').upsert(
        { id: data.user.id },
        { onConflict: 'id', ignoreDuplicates: true }
      );
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>bool</Text>

      {stage === 'phone' ? (
        <>
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            style={styles.input}
            placeholder="+15551234567"
            placeholderTextColor="#aaa"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoFocus
          />
          <TouchableOpacity style={styles.button} onPress={handleSendCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send code</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the code sent to {phone}</Text>
          <TextInput
            style={styles.input}
            placeholder="123456"
            placeholderTextColor="#aaa"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoFocus
          />
          <TouchableOpacity style={styles.button} onPress={handleVerifyCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStage('phone')}>
            <Text style={styles.link}>Use a different number</Text>
          </TouchableOpacity>
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FF6600',
    textAlign: 'center',
    marginBottom: 48,
  },
  label: {
    fontSize: 16,
    color: '#000',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#000',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#43a047',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  link: {
    color: '#43a047',
    textAlign: 'center',
    marginTop: 16,
  },
  error: {
    color: '#d32f2f',
    textAlign: 'center',
    marginTop: 16,
  },
});
