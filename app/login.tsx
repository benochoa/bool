import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { ChevronDown } from '@/assets/symbols/ChevronDown';
import { COUNTRIES, DEFAULT_DIAL } from '@/constants/countryCodes';
import { FontFamily, Type } from '@/constants/theme';
import { supabase } from '@/supabaseClient';

export default function LoginScreen() {
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  // The country's dial code and the national number are entered separately, and
  // only ever joined for Supabase — which wants one E.164 string.
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [phone, setPhone] = useState('');
  const [pickingCountry, setPickingCountry] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Spaces, dashes and brackets are how people write their own number down;
  // E.164 has no room for any of it.
  const nationalNumber = phone.replace(/\D/g, '');
  const fullNumber = `${dial}${nationalNumber}`;

  async function handleSendCode() {
    setError('');
    if (!nationalNumber) {
      setError('Enter your phone number');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: fullNumber });
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
      phone: fullNumber,
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
      <Image source={require('@/assets/images/bool-logo-3.png')} style={styles.logo} contentFit="contain" />

      {stage === 'phone' ? (
        <>
          <Text style={styles.label}>Phone number</Text>
          <View style={styles.phoneRow}>
            <TouchableOpacity style={styles.dialButton} onPress={() => setPickingCountry(true)}>
              <Text style={styles.dialText}>{dial}</Text>
              <ChevronDown size={14} color="#000" />
            </TouchableOpacity>
            <TextInput
              style={[styles.input, styles.phoneInput]}
              placeholder="5551234567"
              placeholderTextColor="#aaa"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoFocus
            />
          </View>
          <TouchableOpacity style={styles.button} onPress={handleSendCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Send code</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the code sent to {fullNumber}</Text>
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
            {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStage('phone')}>
            <Text style={styles.link}>Use a different number</Text>
          </TouchableOpacity>
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Country picker */}
      <Modal
        visible={pickingCountry}
        transparent
        animationType="fade"
        onRequestClose={() => setPickingCountry(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickingCountry(false)}
        >
          <View style={styles.pickerCard} onStartShouldSetResponder={() => true}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {COUNTRIES.map(country => (
                <TouchableOpacity
                  key={country.name}
                  style={styles.countryRow}
                  onPress={() => { setDial(country.dial); setPickingCountry(false); }}
                >
                  <Text style={styles.countryName} numberOfLines={1}>{country.name}</Text>
                  <Text style={styles.countryDial}>{country.dial}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
  logo: {
    // The drawing's own 4:3, so the file is never squashed. It carries a fifth
    // of its height as whitespace top and bottom, which is most of the gap the
    // wordmark used to hold in its margin.
    width: 240,
    aspectRatio: 4 / 3,
    maxWidth: '100%',
    alignSelf: 'center',
    marginBottom: 24,
  },
  label: {
    ...Type.body,
    color: '#000',
    marginBottom: 8,
  },
  input: {
    ...Type.body,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#000',
    marginBottom: 16,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  // The row holds the gap below the pair, so the field gives up its own.
  phoneInput: {
    flex: 1,
    marginBottom: 0,
  },
  // Same border and vertical padding as the field beside it, so the two line up
  // as one control.
  dialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dialText: {
    ...Type.body,
    color: '#000',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCard: {
    width: '80%',
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  countryName: {
    ...Type.body,
    color: '#000',
    flexShrink: 1,
  },
  countryDial: {
    ...Type.body,
    color: '#777',
  },
  button: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#000',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    ...Type.bodyBold,
    color: '#000',
  },
  link: {
    ...Type.label,
    color: '#43a047',
    textAlign: 'center',
    marginTop: 16,
  },
  error: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#d32f2f',
    textAlign: 'center',
    marginTop: 16,
  },
});
