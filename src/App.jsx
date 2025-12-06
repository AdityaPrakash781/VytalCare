import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
// >> IMPORTED: orderBy, limit, where <<
import { getFirestore, collection, query, onSnapshot, addDoc, doc, deleteDoc, orderBy, limit, setDoc, writeBatch, getDocs, where } from 'firebase/firestore';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, Area
} from 'recharts';
import appIcon from "./assets/iconn.png";



import { Plus, X, Trash2, Calendar, Clock, MessageSquare, Bell, Send, Link, Activity, Heart, Moon, Sun, Eye, CheckCircle, AlertCircle, ChevronRight, Droplet, Minus, Phone, Copy, User, Edit2, Save, Ruler, Footprints, Info, Mic, MicOff, Volume2, VolumeX, Globe, Paperclip } from 'lucide-react';

/** ---------------------------------------
 * App Config (unchanged)
 * -------------------------------------- */
const isLocalRun = typeof __initial_auth_token === 'undefined';

//Firebase Config 
const FIREBASE_LOCAL_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MSG_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};


// Gemini & Google Fit keys (local)
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;


const appId = (typeof __app_id !== 'undefined' ? __app_id : 'local-health-app').replace(/[\/.]/g, '-');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const firebaseConfig = isLocalRun
  ? FIREBASE_LOCAL_CONFIG
  : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});

// Health constants
const DAILY_STEP_GOAL = 10000;
const RECOMMENDED_SLEEP_HOURS = 7.5;

// COLOR SCHEME - Removed in favor of Tailwind classes
// const COLORS = { ... };

/** ---------------------------------------
 * Small UI Helpers (unchanged)
 * -------------------------------------- */
const LoadingSpinner = () => (
  <div className="flex justify-center items-center py-4">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
    <span className="ml-3 text-primary font-medium">Loading...</span>
  </div>
);

const ColorBlindFilters = () => (
  <svg style={{ display: 'none' }}>
    <defs>
      <filter id="protanopia">
        <feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" />
      </filter>
      <filter id="deuteranopia">
        <feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
      </filter>
      <filter id="tritanopia">
        <feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
      </filter>
      <filter id="achromatopsia">
        <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
      </filter>
    </defs>
  </svg>
);

const StepCompletionRing = ({ steps, goal, size = 150 }) => {
  const rawPercentage = (steps / goal) * 100;
  const percentage = Math.min(100, Math.round(rawPercentage));
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const isComplete = percentage >= 100;

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <svg width={size} height={size} viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" className="stroke-slate-200" strokeWidth="10" />
        <circle cx="60" cy="60" r={radius} fill="none"
          className={`transition-all duration-1000 ease-out ${isComplete ? 'stroke-green-500' : 'stroke-primary'}`}
          strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <p className={`text-4xl font-extrabold ${isComplete ? 'text-green-600' : 'text-primary'}`}>{percentage}%</p>
        <p className="text-sm font-semibold mt-1 text-text-muted">Completed</p>
      </div>
    </div>
  );
};

const formatTime = (timeStr) => {
  if (!timeStr) return timeStr;
  // Handle HH:MM format (5 chars with colon)
  if (timeStr.length === 5 && timeStr.includes(':')) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return timeStr;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }
  // Handle HHMM format (4 chars without colon) - legacy
  if (timeStr.length === 4) {
    const hours = parseInt(timeStr.substring(0, 2), 10);
    const minutes = timeStr.substring(2, 4);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  }
  return timeStr;
};

// Format time showing 24hr with 12hr in parentheses
const formatTimeWithBoth = (timeStr) => {
  if (!timeStr) return { time24: '', time12: '' };
  let hours, minutes;
  if (timeStr.length === 5 && timeStr.includes(':')) {
    [hours, minutes] = timeStr.split(':').map(Number);
  } else if (timeStr.length === 4) {
    hours = parseInt(timeStr.substring(0, 2), 10);
    minutes = parseInt(timeStr.substring(2, 4), 10);
  } else {
    return { time24: timeStr, time12: '' };
  }
  if (isNaN(hours) || isNaN(minutes)) return { time24: timeStr, time12: '' };
  const time24 = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const time12 = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  return { time24, time12 };
};

const HealthScoreRing = ({ score, size = 180 }) => {
  const percentage = Math.min(100, Math.max(0, score));
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  let color = 'text-red-500';
  if (percentage >= 70) color = 'text-green-500'; // 36 - 70 is yellow ring
  else if (percentage >= 35) color = 'text-yellow-500'; //0-35 is red ring

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width={size} height={size} viewBox="0 0 160 160" className="-rotate-90">
        <circle cx="80" cy="80" r={radius} fill="none" className="stroke-slate-100" strokeWidth="12" />
        <circle cx="80" cy="80" r={radius} fill="none"
          className={`transition-all duration-1000 ease-out ${color} stroke-current`}
          strokeWidth="12"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <p className={`text-5xl font-extrabold ${color}`}>{percentage}%</p>
        <p className="text-sm font-semibold mt-1 text-text-muted">Health Score</p>
      </div>
    </div>
  );
};

/** ---------------------------------------
 * Profile Section Component (UPDATED)
 * -------------------------------------- */
const ProfileSection = ({ db, userId, appId, theme, setTheme, colorBlindMode, setColorBlindMode }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showColorBlindMenu, setShowColorBlindMenu] = useState(false);
  const [profile, setProfile] = useState({
    userName: '',
    userPhone: '',
    userEmail: '',
    userSex: '',
    userAge: '',
    userHeight: '',
    userWeight: '',
    caregiverName: '',
    caregiverPhone: '',
    caregiverEmail: ''
  });
  const [loading, setLoading] = useState(true);

  // CHANGED: Read directly from users/{userId}
  useEffect(() => {
    if (!db || !userId) return;
    // Old Path: .../users/${userId}/profile/data
    // New Path: .../users/${userId}
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}`);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(prev => ({ ...prev, ...docSnap.data() }));
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, userId, appId]);

  // CHANGED: Write directly to users/{userId}
  const handleSave = async () => {
    if (!db || !userId) return;
    try {
      // Old Path: .../users/${userId}/profile/data
      // New Path: .../users/${userId}
      const docRef = doc(db, `/artifacts/${appId}/users/${userId}`);

      // We also save the 'id' field explicitly, just in case n8n needs it in the body
      await setDoc(docRef, { ...profile, id: userId }, { merge: true });

      setIsEditing(false);
    } catch (e) {
      console.error("Error saving profile:", e);
      alert("Failed to save profile.");
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  if (loading) return <div className="p-4"><LoadingSpinner /></div>;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden flex flex-col">
      <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
        <h2 className="text-lg font-bold text-text-main dark:text-white flex items-center">
          <User size={20} className="mr-2 text-primary" />
          Profile
        </h2>
        <button
          onClick={isEditing ? handleSave : () => setIsEditing(true)}
          className={`p-2 rounded-xl transition-all duration-200 ${isEditing ? 'bg-green-500 text-white shadow-md shadow-green-200 hover:bg-green-600' : 'bg-white text-slate-400 hover:text-primary hover:bg-primary/5 border border-slate-200 dark:bg-slate-700 dark:border-slate-600'}`}
          title={isEditing ? "Save Profile" : "Edit Profile"}
        >
          {isEditing ? <Save size={18} /> : <Edit2 size={18} />}
        </button>
      </div>

      <div className="p-6 overflow-y-auto flex-grow scrollbar-thin scrollbar-thumb-slate-200">
        <div className="mb-8">
          <h3 className="text-sm font-bold text-primary dark:text-slate-300 mb-4 flex items-center bg-slate-100 dark:bg-slate-800 p-2 rounded-lg dark:border dark:border-slate-700">
            User Details
          </h3>
          <InputField label="Name" name="userName" placeholder="John Doe" isEditing={isEditing} profile={profile} handleChange={handleChange} />
          <InputField label="Phone No" name="userPhone" type="tel" placeholder="+1 234 567 890" isEditing={isEditing} profile={profile} handleChange={handleChange} />
          <InputField label="Email ID" name="userEmail" type="email" placeholder="john@example.com" isEditing={isEditing} profile={profile} handleChange={handleChange} />
          <div className="grid grid-cols-2 gap-4">
            <InputField label="Sex" name="userSex" placeholder="M/F" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <InputField label="Age" name="userAge" type="number" placeholder="30" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <InputField label="Height" name="userHeight" placeholder="175 cm" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <InputField label="Weight" name="userWeight" placeholder="70 kg" isEditing={isEditing} profile={profile} handleChange={handleChange} />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-secondary dark:text-slate-300 mb-4 flex items-center bg-slate-100 dark:bg-slate-800 p-2 rounded-lg dark:border dark:border-slate-700">
            Caregiver Details
          </h3>
          <InputField label="Name" name="caregiverName" placeholder="Jane Doe" isEditing={isEditing} profile={profile} handleChange={handleChange} />
          <InputField label="Phone No" name="caregiverPhone" type="tel" placeholder="+1 987 654 321" isEditing={isEditing} profile={profile} handleChange={handleChange} />
          <InputField label="Email" name="caregiverEmail" type="email" placeholder="jane@example.com" isEditing={isEditing} profile={profile} handleChange={handleChange} />
        </div>

        <div className="mt-8">
          <h3 className="text-sm font-bold text-slate-500 mb-4 flex items-center bg-slate-100 p-2 rounded-lg dark:bg-slate-800 dark:text-slate-300">
            Accessibility
          </h3>
          <div className="flex gap-2 relative mb-4">
            <button
              onClick={() => {
                setTheme('light');
                setColorBlindMode('none');
                setShowColorBlindMenu(false);
              }}
              className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${theme === 'light' && colorBlindMode === 'none' ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-300'}`}
              aria-pressed={theme === 'light' && colorBlindMode === 'none'}
            >
              <Sun size={20} />
              <span className="text-xs font-semibold">Light</span>
            </button>
            <button
              onClick={() => {
                setTheme('dark');
                setColorBlindMode('none');
                setShowColorBlindMenu(false);
              }}
              className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${theme === 'dark' && colorBlindMode === 'none' ? 'bg-slate-800 text-white border-slate-700 shadow-lg' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-300'}`}
              aria-pressed={theme === 'dark' && colorBlindMode === 'none'}
            >
              <Moon size={20} />
              <span className="text-xs font-semibold">Dark</span>
            </button>

            <button
              onClick={() => setShowColorBlindMenu(!showColorBlindMenu)}
              className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${colorBlindMode !== 'none' ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : showColorBlindMenu ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-300'}`}
              aria-expanded={showColorBlindMenu}
            >
              <Eye size={20} />
              <span className="text-xs font-semibold">Color Blind</span>
            </button>
          </div>

          {/* Inline Expandable Menu for Color Blind Options */}
          {showColorBlindMenu && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2 border border-slate-100 dark:border-slate-700 animate-fade-in space-y-1">
              <button onClick={() => { setColorBlindMode('none'); setShowColorBlindMenu(false); }} className={`w-full text-left px-3 py-3 rounded-lg text-sm flex items-center justify-between ${colorBlindMode === 'none' ? 'bg-white shadow-sm text-primary font-bold border border-slate-100' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                <span>None</span>
                {colorBlindMode === 'none' && <CheckCircle size={16} />}
              </button>
              <button onClick={() => { setColorBlindMode('protanopia'); setTheme('light'); setShowColorBlindMenu(false); }} className={`w-full text-left px-3 py-3 rounded-lg text-sm flex items-center justify-between ${colorBlindMode === 'protanopia' ? 'bg-white shadow-sm text-primary font-bold border border-slate-100' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                <div>
                  <span className="block">Protanopia</span>
                  <span className="text-xs text-slate-400 font-normal">Red-Weak Vision</span>
                </div>
                {colorBlindMode === 'protanopia' && <CheckCircle size={16} />}
              </button>
              <button onClick={() => { setColorBlindMode('deuteranopia'); setTheme('light'); setShowColorBlindMenu(false); }} className={`w-full text-left px-3 py-3 rounded-lg text-sm flex items-center justify-between ${colorBlindMode === 'deuteranopia' ? 'bg-white shadow-sm text-primary font-bold border border-slate-100' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                <div>
                  <span className="block">Deuteranopia</span>
                  <span className="text-xs text-slate-400 font-normal">Green-Weak Vision</span>
                </div>
                {colorBlindMode === 'deuteranopia' && <CheckCircle size={16} />}
              </button>
              <button onClick={() => { setColorBlindMode('tritanopia'); setTheme('light'); setShowColorBlindMenu(false); }} className={`w-full text-left px-3 py-3 rounded-lg text-sm flex items-center justify-between ${colorBlindMode === 'tritanopia' ? 'bg-white shadow-sm text-primary font-bold border border-slate-100' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                <div>
                  <span className="block">Tritanopia</span>
                  <span className="text-xs text-slate-400 font-normal">Blue-Yellow Weak</span>
                </div>
                {colorBlindMode === 'tritanopia' && <CheckCircle size={16} />}
              </button>
              <button onClick={() => { setColorBlindMode('achromatopsia'); setTheme('light'); setShowColorBlindMenu(false); }} className={`w-full text-left px-3 py-3 rounded-lg text-sm flex items-center justify-between ${colorBlindMode === 'achromatopsia' ? 'bg-white shadow-sm text-primary font-bold border border-slate-100' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                <div>
                  <span className="block">Greyscale</span>
                  <span className="text-xs text-slate-400 font-normal">No color perception</span>
                </div>
                {colorBlindMode === 'achromatopsia' && <CheckCircle size={16} />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const InputField = ({ label, name, type = "text", placeholder, isEditing, profile, handleChange }) => (
  <div className="mb-3">
    <label className="block text-xs font-semibold text-text-muted dark:text-slate-400 mb-1 uppercase tracking-wider">{label}</label>
    {isEditing ? (
      <input
        type={type}
        name={name}
        value={profile[name]}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full p-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50 dark:bg-slate-900 dark:text-white"
      />
    ) : (
      <p className="text-sm font-medium text-text-main dark:text-white break-words">{profile[name] || <span className="text-slate-300 italic">Not set</span>}</p>
    )}
  </div>
);

/** ---------------------------------------
 * Auth Login Card (unchanged)
 * -------------------------------------- */
const LoginPage = ({ handleLogin, error }) => (
  <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-background dark:bg-slate-950">
    <div className="max-w-md w-full p-8 rounded-3xl shadow-xl bg-surface dark:bg-slate-900 text-center border border-slate-100 dark:border-slate-800 animate-fade-in">
      <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700">
        <img
          src={appIcon}
          alt="VytalCare Logo"
          className="w-full h-full object-contain"
        />
      </div>
      <h1 className="text-4xl font-bold mb-3 text-text-main dark:text-white tracking-tight">VytalCare</h1>
      <p className="text-lg mb-8 text-text-muted dark:text-slate-400">
        Your personal AI health companion. Sign in to manage medications and track your vitals.
      </p>

      {error && !error.type && (
        <div className="p-4 rounded-xl mb-6 bg-red-50 text-red-600 border border-red-100 text-sm font-medium">
          {typeof error === 'string' ? error : JSON.stringify(error)}
        </div>
      )}

      <button
        onClick={handleLogin}
        className="w-full py-4 text-white text-lg font-bold rounded-xl transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5 bg-primary flex items-center justify-center group"
      >
        <img
          src="https://www.gstatic.com/images/icons/material/system/2x/google_white_24dp.png"
          alt="Google icon"
          className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform"
        />
        Sign In with Google
      </button>

      <p className="mt-6 text-xs text-text-muted">
        By connecting, you authorize access to your Google Fit activity, sleep, and heart-rate data.
      </p>
    </div>
  </div>
);

/** ---------------------------------------
 * Networking helper (unchanged)
 * -------------------------------------- */
const exponentialBackoffFetch = async (url, options, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 429 && i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
    }
  }
  throw new Error("Failed to fetch after multiple retries.");
};

/** ---------------------------------------
 * Main App
 * -------------------------------------- */
const INITIAL_CHAT_WELCOME = { role: 'model', text: 'Hello! I am your VytalCare Chatbot. I can provide general information on medications, conditions, and health topics using Google Search for the latest context. Always consult a professional for medical advice!', sources: [], createdAt: Date.now() };

const getTodayDateKey = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const METRIC_INFO = {
  steps: {
    title: "Daily Steps",
    desc: "Walking is a low-impact exercise that boosts cardiovascular health. The 10,000 steps goal is a common standard for maintaining an active lifestyle, helping to reduce the risk of chronic diseases."
  },
  sleep: {
    title: "Sleep Duration",
    desc: "Quality sleep is essential for physical recovery and mental clarity. Most adults need between 7 and 9 hours. Consistent sleep patterns help regulate mood, improve memory, and strengthen the immune system."
  },
  calories: {
    title: "Calories Burned",
    desc: "This metric estimates the total energy your body has used today, including your resting metabolism (BMR) and active movement. Monitoring this helps in managing weight and energy levels."
  },
  hydration: {
    title: "Hydration",
    desc: "Water is vital for every cell in your body. It regulates temperature, lubricates joints, and aids digestion. A general goal is about 2-3 liters per day, depending on your activity level and climate."
  },
  distance: {
    title: "Distance Covered",
    desc: "This tracks the total kilometers you have walked or run today. Tracking distance is a great way to measure endurance and progress towards fitness goals."
  },
  heartRate: {
    title: "Heart Rate",
    desc: "Measured in Beats Per Minute (BPM). A lower resting heart rate (typically 60-100 BPM) generally indicates better cardiovascular fitness and efficient heart function."
  }
};

const App = () => {
  // Firebase & core state
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [medications, setMedications] = useState([]);
  const [newMedication, setNewMedication] = useState({ name: '', dose: '', times: ['08:00'] });
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('reminders');
  //For Metric Description
  const [activeInfoMetric, setActiveInfoMetric] = useState(null);

  // >> NEW: State for "Taken" Tracking and Time <<
  const [takenMedications, setTakenMedications] = useState(new Set());
  const [now, setNow] = useState(new Date());

  // Timer to update 'now' every minute (and check date change)
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNow(d);
      // Ensure dateKey is current (using existing helper)
      const key = getTodayDateKey();
      setCurrentDateKey(prev => (prev !== key ? key : prev));
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Accessibility State
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    // Default to OS preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });
  const [colorBlindMode, setColorBlindMode] = useState(() => localStorage.getItem('colorBlindMode') || 'none');

  // Apply Theme
  useEffect(() => {
    // Enable smooth transitions
    document.documentElement.classList.add('transitioning');

    // Set data-theme attribute
    document.documentElement.setAttribute('data-theme', theme);

    // Toggle dark class for Tailwind
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Save to localStorage
    localStorage.setItem('theme', theme);

    // Update theme-color meta tag for mobile
    const themeColor = theme === 'dark' ? '#071027' : '#f7fafc';
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.name = 'theme-color';
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', themeColor);

    // Remove transitioning class after animation
    const timeout = setTimeout(() => {
      document.documentElement.classList.remove('transitioning');
    }, 300);

    return () => clearTimeout(timeout);
  }, [theme]);

  // Apply Color Blind Mode
  useEffect(() => {
    if (colorBlindMode && colorBlindMode !== 'none') {
      document.documentElement.style.filter = `url(#${colorBlindMode})`;
    } else {
      document.documentElement.style.filter = 'none';
    }
    localStorage.setItem('colorBlindMode', colorBlindMode);
  }, [colorBlindMode]);

  // Chatbot
  // >> INITIAL CHAT HISTORY IS NOW A WELCOME MESSAGE ONLY <<
  const [chatHistory, setChatHistory] = useState([INITIAL_CHAT_WELCOME]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null); // NEW: image attached to next message
  const [showAttachMenu, setShowAttachMenu] = useState(false); // NEW: show upload / camera choice

  // Google Fit auth token (unchanged)
  const [googleAccessToken, setGoogleAccessToken] = useState(null);

  // Health metrics (unchanged)
  const [stepCount, setStepCount] = useState(null);
  const [sleepHours, setSleepHours] = useState(null);
  const [calories, setCalories] = useState(null);
  const [distance, setDistance] = useState(null); // km
  const [heartRate, setHeartRate] = useState(null); // FIX 1 & 2: Complete heartRate state declaration
  const [heartRateTrend, setHeartRateTrend] = useState([]);
  const [stepsTrend, setStepsTrend] = useState([]);
  const [distanceTrend, setDistanceTrend] = useState([]);
  const [sleepTrend, setSleepTrend] = useState([]);

  // Hydration state
  const [currentDateKey, setCurrentDateKey] = useState(getTodayDateKey());
  const [hydration, setHydration] = useState(0);
  const [hydrationGoal, setHydrationGoal] = useState(2000); // Default goal 2000ml
  const [healthScore, setHealthScore] = useState(null);

  // Health score explanation + suggestions
  const [healthScoreExplanation, setHealthScoreExplanation] = useState([]);
  const [healthScoreSuggestions, setHealthScoreSuggestions] = useState([]);

  // Graph updation 
  const [steps3hTrend, setSteps3hTrend] = useState([]);
  const [distance3hTrend, setDistance3hTrend] = useState([]);
  const [weeklyDistance, setWeeklyDistance] = useState([]);

  // Auto-scroll & Glow refs
  const [highlightedGraph, setHighlightedGraph] = useState(null);
  const stepsRef = useRef(null);
  const sleepRef = useRef(null);
  const distanceRef = useRef(null);
  const heartRateRef = useRef(null);

  const scrollToGraph = (metric) => {
    let ref = null;
    if (metric === 'steps') ref = stepsRef;
    else if (metric === 'sleep') ref = sleepRef;
    else if (metric === 'distance') ref = distanceRef;
    else if (metric === 'heartRate') ref = heartRateRef;

    if (ref && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedGraph(metric);
      setTimeout(() => setHighlightedGraph(null), 1500);
    }
  };

  // Loading flags (unchanged)
  const [isStepsLoading, setIsStepsLoading] = useState(false);
  const [isSleepLoading, setIsSleepLoading] = useState(false);
  const [isCaloriesLoading, setIsCaloriesLoading] = useState(false);
  const [isDistanceLoading, setIsDistanceLoading] = useState(false);
  const [isHeartRateLoading, setIsHeartRateLoading] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isAutoSyncActive, setIsAutoSyncActive] = useState(false);

  // Assessment (unchanged)
  const [assessmentResult, setAssessmentResult] = useState(null);
  const [isAssessmentLoading, setIsAssessmentLoading] = useState(false);

  /** ----------------------------
   * Firebase init & auth (unchanged)
   * --------------------------- */
  useEffect(() => {
    // ... (Firebase init logic) ...
    try {
      const isConfigMissing = !firebaseConfig.apiKey;
      if (isConfigMissing) {
        if (isLocalRun) {
          setError("DATABASE/AUTH ERROR: Please update FIREBASE_LOCAL_CONFIG in App.jsx for local persistence.");
        } else {
          setError("Failed to initialize the app due to missing config.");
        }
        setDb(null);
        setAuth(null);
        setUserId(crypto.randomUUID());
        setIsLoading(false);
        return;
      }

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);

      setDb(firestore);
      setAuth(authentication);

      const unsubscribeAuth = onAuthStateChanged(authentication, async (user) => {
        if (user) {
          setUserId(user.uid);
          setIsLoading(false);
        } else {
          if (initialAuthToken) {
            await signInWithCustomToken(authentication, initialAuthToken);
          } else {
            const anonUser = await signInAnonymously(authentication);
            setUserId(anonUser.user.uid);
          }
          setIsLoading(false);
        }
      });

      return () => unsubscribeAuth();
    } catch (e) {
      console.error("Firebase Initialization Error:", e);
      setError("Failed to initialize the app. Check console for details.");
      setIsLoading(false);
    }
  }, [isLocalRun]);

  /** ----------------------------
   * Firestore Listeners
   * --------------------------- */

  // 1. Medication Listener
  useEffect(() => {
    if (!db || !userId) return;
    const q = query(collection(db, `/artifacts/${appId}/users/${userId}/medications`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMedications(meds);
    }, (error) => {
      console.error("Error fetching medications:", error);
      if (auth?.currentUser) setError("Failed to fetch medications.");
    });
    return () => unsubscribe();
  }, [db, userId, auth]);

  // 1b. Medication Logs Listener (Live Sync for "Taken" status)
  useEffect(() => {
    if (!db || !userId) return;
    const q = query(
      collection(db, `/artifacts/${appId}/users/${userId}/medication_logs`),
      where('dateKey', '==', currentDateKey)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const takenSet = new Set();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.medicationId && data.scheduledTime && data.status === 'taken') {
          takenSet.add(`${data.medicationId}_${data.scheduledTime}`);
        }
      });
      setTakenMedications(takenSet);
    }, (e) => console.error("Error fetching logs:", e));
    return () => unsubscribe();
  }, [db, userId, currentDateKey]);

  // 2. Chat History Listener
  useEffect(() => {
    if (!db || !userId) return;
    const chatCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/chats`);
    // Filter messages created after the last clear time
    const qChat = query(
      chatCollectionRef,
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(qChat, (snapshot) => {
      const chatMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (chatMessages.length > 0) {
        setChatHistory(chatMessages);
      } else {
        setChatHistory([INITIAL_CHAT_WELCOME]);
      }
    }, (error) => {
      console.error("Failed to fetch chat history:", error);
      if (auth?.currentUser) setError("Failed to fetch chat history.");
    });

    return () => unsubscribe();
  }, [db, userId, auth]);

  // >> VOICE FEATURES <<
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false); // New: Continuous Voice Mode
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const recognitionRef = useRef(null);

  // Supported Languages (Updated with Indian Languages)
  const LANGUAGES = [
    { code: 'en-US', name: 'English (US)', voice: 'Google US English' },
    { code: 'en-IN', name: 'English (India)', voice: 'Google UK English Female' }, // Fallback to UK if IN not found
    { code: 'hi-IN', name: 'Hindi', voice: 'Google हिन्दी' },
    { code: 'ta-IN', name: 'Tamil', voice: 'Google தமிழ்' },
    { code: 'kn-IN', name: 'Kannada', voice: 'Google ಕನ್ನಡ' },
    { code: 'te-IN', name: 'Telugu', voice: 'Google తెలుగు' },
  ];

  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setChatInput(transcript);
        setIsListening(false);

        // If in Voice Mode, automatically send the message
        if (isVoiceMode) {
          // We need to trigger the send logic. 
          // Since callChatbotAPI is a function, we can call it directly.
          // However, we need to ensure chatInput state is updated first.
          // Actually, using the transcript directly is safer here to avoid state race conditions.
          callChatbotAPI(transcript);
          setChatInput(''); // Clear input after sending
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
        // In voice mode, if error is 'no-speech', maybe restart? 
        // For now, let's stop to avoid infinite error loops.
        if (isVoiceMode && event.error === 'no-speech') {
          // Optional: restart listening?
          // setIsListening(true); recognitionRef.current.start();
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, [isVoiceMode]); // Re-bind if voice mode changes (though refs usually stable)

  // Update language for recognition
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedLanguage;
    }
  }, [selectedLanguage]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setIsVoiceMode(false); // Stop voice mode if manually stopped
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const startVoiceMode = () => {
    setIsVoiceMode(true);
    setSpeechEnabled(true); // Force enable TTS for voice mode
    recognitionRef.current?.start();
    setIsListening(true);
  };

  const stopVoiceMode = () => {
    setIsVoiceMode(false);
    recognitionRef.current?.stop();
    window.speechSynthesis.cancel();
    setIsListening(false);
    setIsSpeaking(false);
  };

  const speakText = (text) => {
    if ((!speechEnabled && !isVoiceMode) || !text) return;

    // Cancel current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = selectedLanguage;

    // Try to find a matching voice - Prioritize "Natural" or "Google"
    const voices = window.speechSynthesis.getVoices();
    const langConfig = LANGUAGES.find(l => l.code === selectedLanguage);

    let voice = null;
    if (langConfig) {
      // 1. Try specific voice name from config
      voice = voices.find(v => v.name.includes(langConfig.voice));
      // 2. Try any voice for the language
      if (!voice) voice = voices.find(v => v.lang === selectedLanguage);
    }
    if (voice) utterance.voice = voice;

    utterance.onstart = () => setIsSpeaking(true);

    utterance.onend = () => {
      setIsSpeaking(false);
      // Continuous Loop: If in Voice Mode, start listening again after speaking
      if (isVoiceMode) {
        setTimeout(() => {
          recognitionRef.current?.start();
          setIsListening(true);
        }, 500); // Small delay for natural pause
      }
    };

    utterance.onerror = (event) => {
      console.error("Speech synthesis error", event);
      setIsSpeaking(false);
      // Even on error, try to continue the loop if in voice mode
      if (isVoiceMode) {
        setTimeout(() => {
          recognitionRef.current?.start();
          setIsListening(true);
        }, 1000);
      }
    };



    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  // Stop speaking on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);


  // 3. Hydration Listener
  useEffect(() => {
    if (!db || !userId) return;
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/hydration/${currentDateKey}`);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setHydration(data.amount || 0);
        if (data.goal) setHydrationGoal(data.goal);
      } else {
        setHydration(0);
      }
    }, (error) => {
      console.error("Error fetching hydration:", error);
    });
    return () => unsubscribe();
  }, [db, userId, currentDateKey]);

  // Hydration Midnight Reset
  useEffect(() => {
    const checkMidnightReset = () => {
      const newKey = getTodayDateKey();
      if (newKey !== currentDateKey) {
        setCurrentDateKey(newKey);
      }
    };

    // Check immediately
    checkMidnightReset();

    // Check every minute
    const interval = setInterval(checkMidnightReset, 60000);

    return () => clearInterval(interval);
  }, [currentDateKey]);

  const updateHydration = async (amountToAdd) => {
    if (!db || !userId) return;
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/hydration/${currentDateKey}`);

    const newAmount = Math.max(0, hydration + amountToAdd);
    setHydration(newAmount); // Optimistic update

    try {
      await setDoc(docRef, {
        amount: newAmount,
        goal: hydrationGoal,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.error("Error updating hydration:", e);
      setError("Failed to update hydration.");
      setHydration(hydration); // Revert on error
    }
  };

  // Browser Notification Permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);







  // Check for reminders every minute
  useEffect(() => {
    const checkReminders = () => {
      if (Notification.permission !== 'granted') return;

      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      medications.forEach(med => {
        if (med.times && Array.isArray(med.times)) {
          med.times.forEach(time => {
            const [h, m] = time.split(':').map(Number);
            if (h === currentHour && currentMinute === m) {
              new Notification(`Time to take ${med.name}`, {
                body: `It's ${time}. Dose: ${med.dose}`,
                icon: '/vite.svg'
              });
            }
          });
        }
      });
    };

    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000;

    let interval;
    const timeout = setTimeout(() => {
      checkReminders();
      interval = setInterval(checkReminders, 60000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [medications]);

  /** ----------------------------
   * OAuth Login (unchanged)
   * --------------------------- */
  const handleLogin = () => {
    // ... (unchanged) ...
    const redirectUri = window.location.origin;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${redirectUri}&` +
      `response_type=token&` +
      // NOTE: add heart_rate scope
      `scope=${encodeURIComponent([
        'https://www.googleapis.com/auth/fitness.activity.read',
        'https://www.googleapis.com/auth/fitness.sleep.read',
        'https://www.googleapis.com/auth/fitness.heart_rate.read',
        'https://www.googleapis.com/auth/fitness.location.read'
      ].join(' '))}&` +
      `state=google-fit-connect`;
    window.location.href = authUrl;
  };

  // Parse access token from URL (unchanged)
  useEffect(() => {
    if (window.location.hash) {
      const hash = window.location.hash.substring(1);
      const params = hash.split('&').reduce((acc, part) => {
        const [key, value] = part.split('=');
        if (key && value) acc[decodeURIComponent(key)] = decodeURIComponent(value);
        return acc;
      }, {});
      const accessToken = params['access_token'];
      const state = params['state'];
      if (accessToken && state === 'google-fit-connect') {
        setGoogleAccessToken(accessToken);
        setError({ type: 'success', message: 'Signed in with Google and connected to Fit successfully! Welcome.' });
        window.history.replaceState({}, document.title, window.location.pathname);
        setActiveTab('activity');
      }
    }
  }, []);

  /** ---------------------------------------
   * Helpers: consistent time window (unchanged)
   * -------------------------------------- */
  const getTodayWindow = () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const tzOffset = new Date().getTimezoneOffset() * 60 * 1000; // ms
    const localMidnight = now - ((now - tzOffset) % oneDayMs); // local day start
    const LATENCY_BUFFER_MS = 2 * 60 * 1000;
    return {
      startTimeMillis: localMidnight,
      endTimeMillis: now - LATENCY_BUFFER_MS
    };
  };

  /** ---------------------------------------
   * Google Fit Fetchers (unchanged)
   * -------------------------------------- */
  // ... (fetchSteps, fetchSleep, fetchCalories, fetchDistance, fetchHeartRate, syncAll unchanged) ...

  const fetchSteps = useCallback(async () => {
    if (!googleAccessToken) { setError('Error: Google Fit Access Token is missing. Please sign in again.'); return 0; }
    setIsStepsLoading(true);
    const { startTimeMillis, endTimeMillis } = getTodayWindow();
    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.step_count.delta",
        dataSourceId: "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps"
      }],
      bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
      startTimeMillis, endTimeMillis
    };
    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      const steps = data.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.intVal;
      if (typeof steps === 'number') {
        setStepCount(steps);
        setStepsTrend([{ name: 'Today', steps: steps, goal: DAILY_STEP_GOAL }]);
        return steps;
      } else {
        setStepCount(0);
        setError('No step data found for today.');
        return 0;
      }
    } catch (e) {
      console.error(e);
      setStepCount(0);
      setError('Failed to fetch steps.');
      return 0;
    } finally {
      setIsStepsLoading(false);
    }
  }, [googleAccessToken]);

  const fetchSteps3h = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0); // today at midnight

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.step_count.delta",
        dataSourceId: "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps"
      }],
      bucketByTime: { durationMillis: 0.75 * 60 * 60 * 1000 }, // 3 hours
      startTimeMillis: start.getTime(),
      endTimeMillis: now
    };

    try {
      const res = await fetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      let cumulative = 0;

      const trend = data.bucket.map(b => {
        const pts = b.dataset?.[0]?.point;
        const deltaSteps = pts?.[0]?.value?.[0]?.intVal ?? 0;

        cumulative += deltaSteps;

        return {
          time: new Date(parseInt(b.startTimeMillis)).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          }),
          steps: cumulative,       // used by the line
          stepsArea: cumulative    // 👈 used by the gradient area
        };
      });


      setSteps3hTrend(trend);

    } catch (err) {
      console.error("3h Steps Error:", err);
    }
  }, [googleAccessToken]);

  const fetchDistance3h = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.distance.delta",
        dataSourceId: "derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta"
      }],
      bucketByTime: { durationMillis: 0.75 * 60 * 60 * 1000 },
      startTimeMillis: start.getTime(),
      endTimeMillis: now
    };

    try {
      const res = await fetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      const trend = data.bucket.map(b => {
        const pts = b.dataset?.[0]?.point;
        const meters = pts?.[0]?.value?.[0]?.fpVal ?? 0;

        return {
          time: new Date(parseInt(b.startTimeMillis)).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          }),
          km: parseFloat((meters / 1000).toFixed(2))
        };
      });
      // Convert to cumulative distance
      let cumulative = 0;
      const cumulativeTrend = trend.map(entry => {
        cumulative += entry.km;
        return {
          time: entry.time,
          km: parseFloat(cumulative.toFixed(2))
        };
      });

      setDistance3hTrend(cumulativeTrend);
    } catch (err) {
      console.error("3h Distance Error:", err);
    }
  }, [googleAccessToken]);


  const fetchSleep = useCallback(async () => {
    if (!googleAccessToken) { setError('Error: Google Fit Access Token is missing. Please sign in again.'); return 0; }
    setIsSleepLoading(true);
    const now = Date.now();
    const startTimeIso = new Date(now - 36 * 60 * 60 * 1000).toISOString();
    const endTimeIso = new Date(now).toISOString();
    const sessionsUrl = `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${startTimeIso}&endTime=${endTimeIso}&activityType=72`;
    try {
      const res = await exponentialBackoffFetch(sessionsUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      const sleepSessions = data.session || [];
      if (!sleepSessions.length) {
        setSleepHours(0);
        setError('No sleep data found for the past 36 hours.');
        return 0;
      }
      const oneDayMs = 24 * 60 * 60 * 1000;
      const totalSleepMs = sleepSessions.reduce((total, s) => {
        if (s.endTimeMillis > (now - oneDayMs)) {
          return total + (s.endTimeMillis - s.startTimeMillis);
        }
        return total;
      }, 0);
      const hours = Math.round((totalSleepMs / (1000 * 60 * 60)) * 10) / 10;
      setSleepHours(hours);
      return hours;
    } catch (e) {
      console.error(e);
      setSleepHours(0);
      setError('Failed to fetch sleep data.');
      return 0;
    } finally {
      setIsSleepLoading(false);
    }
  }, [googleAccessToken]);

  const fetchWeeklySleep = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const url =
      `https://www.googleapis.com/fitness/v1/users/me/sessions?` +
      `startTime=${new Date(sevenDaysAgo).toISOString()}` +
      `&endTime=${new Date(now).toISOString()}` +
      `&activityType=72`;

    try {
      const res = await exponentialBackoffFetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      const sessions = data.session || [];

      // Group by day
      const daily = {};

      sessions.forEach((s) => {
        const start = new Date(parseInt(s.startTimeMillis));
        const end = new Date(parseInt(s.endTimeMillis));
        const hours = (end - start) / (1000 * 60 * 60);

        const dayKey = start.toISOString().split("T")[0];

        if (!daily[dayKey]) daily[dayKey] = 0;
        daily[dayKey] += hours;
      });

      // Build final chart list (sorted)
      const result = Object.keys(daily)
        .sort()
        .map((d) => {
          const dateObj = new Date(d);
          const label =
            dateObj.toLocaleDateString("en-US", { weekday: "short" }) +
            " "; // Sat 23

          return {
            name: label,
            hours: Math.round(daily[d] * 10) / 10,
          };
        });

      setSleepTrend(result);
    } catch (err) {
      console.error("Weekly Sleep Error:", err);
      setSleepTrend([]);
    }
  }, [googleAccessToken]);


  // Calories (merged source) — matches Google Fit app totals
  const fetchCalories = useCallback(async () => {
    if (!googleAccessToken) { setError('Error: Google Fit Access Token is missing. Please sign in again.'); return 0; }
    setIsCaloriesLoading(true);
    const { startTimeMillis, endTimeMillis } = getTodayWindow();
    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.calories.expended",
        dataSourceId: "derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended"
      }],
      bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
      startTimeMillis, endTimeMillis
    };
    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      const kcal = data.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal;
      if (typeof kcal === 'number') {
        setCalories(Math.round(kcal));
        return kcal;
      } else {
        setCalories(0);
        setError('No calories data found for today.');
        return 0;
      }
    } catch (e) {
      console.error(e);
      setCalories(0);
      setError('Failed to fetch calories.');
      return 0;
    } finally {
      setIsCaloriesLoading(false);
    }
  }, [googleAccessToken]);

  // Distance (merged source) — fixes “0 km” mismatch
  const fetchDistance = useCallback(async () => {
    if (!googleAccessToken) { setError('Error: Google Fit Access Token is missing. Please sign in again.'); return 0; }
    setIsDistanceLoading(true);
    const { startTimeMillis, endTimeMillis } = getTodayWindow();
    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.distance.delta",
        dataSourceId: "derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta"
      }],
      bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
      startTimeMillis, endTimeMillis
    };
    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      // Robust parsing: Sum up all points in all buckets
      let totalMeters = 0;
      if (data.bucket && Array.isArray(data.bucket)) {
        data.bucket.forEach(bucket => {
          if (bucket.dataset && Array.isArray(bucket.dataset)) {
            bucket.dataset.forEach(ds => {
              if (ds.point && Array.isArray(ds.point)) {
                ds.point.forEach(p => {
                  if (p.value && Array.isArray(p.value)) {
                    const val = p.value[0]?.fpVal;
                    if (typeof val === 'number') {
                      totalMeters += val;
                    }
                  }
                });
              }
            });
          }
        });
      }

      if (totalMeters > 0) {
        const km = totalMeters / 1000;
        setDistance(km.toFixed(2));
        setDistanceTrend(prev => [...prev.slice(-11), { name: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), km: parseFloat((km).toFixed(2)) }]);
        return km;
      } else {
        setDistance(0);
        // Don't show error if just 0 distance, it might be valid
        return 0;
      }
    } catch (e) {
      console.error("Distance fetch error:", e);
      setDistance(0);
      if (e.message.includes('403')) {
        setError('Permission denied for distance. Please sign out and sign in again to grant location access.');
      } else {
        setError('Failed to fetch distance.');
      }
      return 0;
    } finally {
      setIsDistanceLoading(false);
    }
  }, [googleAccessToken]);

  // Heart rate — return latest sample seen in last 24h or show “no data” message
  const fetchHeartRate = useCallback(async () => {
    if (!googleAccessToken) { setError('Error: Google Fit Access Token is missing. Please sign in again.'); return null; }
    setIsHeartRateLoading(true);
    const now = Date.now();
    const startTimeMillis = now - 24 * 60 * 60 * 1000;
    const endTimeMillis = now - 60 * 1000; // 1-minute buffer

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.heart_rate.bpm",
        dataSourceId: "derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm"
      }],
      bucketByTime: { durationMillis: 60 * 60 * 1000 }, // hourly buckets
      startTimeMillis, endTimeMillis
    };

    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      let latestBpm = null; // FIX 3: Declare latestBpm in the outer scope.

      // prepare trend data (hourly buckets)
      if (Array.isArray(data.bucket)) {
        const hrData = data.bucket.map(b => {
          const pts = b?.dataset?.[0]?.point;
          const bpmVal = (Array.isArray(pts) && pts.length) ? (pts[pts.length - 1]?.value?.[0]?.fpVal ?? null) : null;
          return {
            time: new Date(parseInt(b.startTimeMillis)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            bpm: typeof bpmVal === 'number' ? Math.round(bpmVal) : null
          };
        }).filter(d => d.bpm !== null);
        if (hrData.length) setHeartRateTrend(hrData);

        // find the most recent bucket that has at least one point
        for (let i = data.bucket.length - 1; i >= 0; i--) {
          const pts = data.bucket[i]?.dataset?.[0]?.point;
          if (Array.isArray(pts) && pts.length) {
            const lastPoint = pts[pts.length - 1];
            const v = lastPoint?.value?.[0]?.fpVal;
            if (typeof v === 'number') { latestBpm = Math.round(v); break; }
          }
        }
      }
      // FIX 4, 5, 6, 7: Removed unnecessary else block, duplicated loop, and hanging brace.

      if (latestBpm !== null) {
        setHeartRate(latestBpm);
        return latestBpm;
      } else {
        setHeartRate(null);
        setError('No heart-rate data found in the last 24 hours (wearable not connected).');
        return null;
      }
    } catch (e) {
      console.error(e);
      setHeartRate(null);
      setError('Failed to fetch heart-rate.');
      return null;
    } finally {
      setIsHeartRateLoading(false);
    }
  }, [googleAccessToken]);

  const fetchWeeklyDistance = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const start = now - 7 * 24 * 60 * 60 * 1000; // last 7 days

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.distance.delta",
        dataSourceId: "derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta"
      }],
      bucketByTime: { durationMillis: 24 * 60 * 60 * 1000 }, // 1 day per bucket
      startTimeMillis: start,
      endTimeMillis: now
    };

    try {
      const res = await fetch(
        "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      const data = await res.json();

      const week = (data.bucket || []).map(b => {
        const meters = b.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal || 0;
        return {
          day: new Date(parseInt(b.startTimeMillis)).toLocaleDateString([], {
            weekday: "short"
          }),
          km: +(meters / 1000).toFixed(2)
        };
      });

      setWeeklyDistance(week);
    } catch (err) {
      console.error("Weekly Distance Error:", err);
    }
  }, [googleAccessToken]);

  const calculateHealthScore = useCallback(() => {
    let score = 0;

    const reasons = [];
    const suggestions = [];

    // STEPS — 20 pts
    if (stepCount !== null) {
      const ratio = Math.min(stepCount / DAILY_STEP_GOAL, 1);
      const pts = ratio * 20;
      score += pts;

      if (ratio >= 1) reasons.push("You met your steps goal.");
      else if (ratio >= 0.5) reasons.push("You got a moderate amount of steps.");
      else reasons.push("Low step count today reduced your score.");

      if (ratio < 1) suggestions.push("Try walking 10–15 minutes more.");
    }

    // SLEEP — 20 pts
    if (sleepHours !== null) {
      const ratio = Math.min(sleepHours / RECOMMENDED_SLEEP_HOURS, 1);
      const pts = ratio * 20;
      score += pts;

      if (ratio >= 1) reasons.push("Your sleep duration was good.");
      else if (ratio >= 0.7) reasons.push("Your sleep was slightly below ideal.");
      else reasons.push("Low sleep affected recovery.");

      if (ratio < 1) suggestions.push("Aim for 30–45 extra minutes of sleep.");
    }

    // HYDRATION - 20 pts
    if (hydration !== null) {
      const ratio = Math.min(hydration / hydrationGoal, 1);
      const pts = ratio * 20;
      score += pts;

      if (ratio >= 1) reasons.push("You met your hydration goal.");
      else if (ratio >= 0.5) reasons.push("Good water intake so far.");
      else reasons.push("Low water intake.");

      if (ratio < 1) suggestions.push("Drink a glass of water now.");
    }

    // CALORIES — 10 pts
    if (calories !== null) {
      const ratio = Math.min(calories / 500, 1);
      const pts = ratio * 10;
      score += pts;

      if (ratio >= 1) reasons.push("Good calorie burn today.");
      else if (ratio >= 0.5) reasons.push("Moderate activity level.");
      else reasons.push("Calorie burn is low.");

      if (ratio < 1) suggestions.push("Do a 10–20 min walk to increase burn.");
    }

    // DISTANCE — 10 pts
    if (distance !== null) {
      const ratio = Math.min(parseFloat(distance) / 5, 1);
      const pts = ratio * 10;
      score += pts;

      if (ratio >= 1) reasons.push("You walked a great distance.");
      else if (ratio >= 0.5) reasons.push("Decent walking distance.");
      else reasons.push("Low distance walked.");

      if (ratio < 1) suggestions.push("Try to add small walking intervals.");
    }

    // HEART RATE — 20 pts
    if (heartRate !== null) {
      const deviation = Math.abs(heartRate - 75);
      const hrScore = Math.max(0, 1 - deviation / 40);
      const pts = hrScore * 20;
      score += pts;

      if (deviation <= 5) reasons.push("Your heart rate is in a healthy range.");
      else if (deviation <= 15) reasons.push("Heart rate is slightly elevated.");
      else reasons.push("Heart rate is high today.");

      if (deviation > 10)
        suggestions.push("Try deep breathing or relaxing for a bit.");
    }

    const finalScore = Math.round(score);

    setHealthScore(finalScore);
    setHealthScoreExplanation(reasons.slice(0, 3));
    setHealthScoreSuggestions(suggestions.slice(0, 3));
  }, [stepCount, sleepHours, calories, distance, heartRate, hydration, hydrationGoal]);



  // One-click sync (does all fetches, shows explicit messages)
  const syncAll = useCallback(async () => {
    setIsSyncingAll(true);
    setAssessmentResult(null);
    try {
      const results = await Promise.allSettled([
        fetchSteps(),
        fetchSleep(),
        fetchWeeklySleep(),
        fetchCalories(),
        fetchDistance(),
        fetchWeeklyDistance(),
        fetchHeartRate(),
        fetchSteps3h(),
        fetchDistance3h()

      ]);

      // If every promise failed or returned empty values, show a generic banner
      const someData =
        (stepCount ?? 0) > 0 ||
        (sleepHours ?? 0) > 0 ||
        (calories ?? 0) > 0 ||
        (parseFloat(distance) ?? 0) > 0 ||
        (heartRate ?? null) !== null;

      if (!someData) {
        setError('Synced, but no metrics were available for today. Open Google Fit and sync your device, then try again.');
      } else {
        setError({ type: 'success', message: 'Synced today’s data successfully.' });
        calculateHealthScore();
      }

      return results;
    } finally {
      setIsSyncingAll(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleAccessToken, stepCount, sleepHours, calories, distance, heartRate, fetchSteps, fetchSleep, fetchCalories, fetchDistance, fetchHeartRate]); // Added fetch* dependencies to suppress linter warning

  // Auto-sync: call once on login, and enable repeating sync when user presses Sync button
  useEffect(() => {
    if (!googleAccessToken) return;
    // call once on login
    syncAll();
  }, [googleAccessToken, syncAll]); // FIX 8: Added syncAll to dependency array

  useEffect(() => {
    if (!googleAccessToken) return;
    let interval = null;
    if (isAutoSyncActive) {
      // start immediate and then every 20s
      syncAll();
      interval = setInterval(() => { syncAll(); }, 20000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isAutoSyncActive, googleAccessToken, syncAll]); // FIX 9: Added syncAll to dependency array


  /** ---------------------------------------
 * Assessment (updated to include hydration and better formatting)
 * -------------------------------------- */
  const callAssessmentAPI = useCallback(async () => {
    const apiKey = isLocalRun ? GEMINI_API_KEY : "";
    if (!apiKey) {
      setError("GEMINI API ERROR: Missing API Key in local run.");
      return;
    }
    setIsAssessmentLoading(true);

    const prompt = `
Analyze these health metrics and provide a concise wellness assessment:

**Today's Metrics:**
- Steps: ${stepCount ?? "N/A"}
- Sleep: ${sleepHours ?? "N/A"} hours
- Calories: ${calories ?? "N/A"} kcal
- Distance: ${distance ?? "N/A"} km
- Heart Rate: ${heartRate ?? "N/A"} bpm
- Water Intake: ${hydration ?? "N/A"} ml (Goal: ${hydrationGoal} ml)

**Recent Trends:**
- Steps Trend: ${stepsTrend.length > 0 ? stepsTrend[stepsTrend.length - 1]?.steps : "N/A"}
- Sleep Trend: ${sleepTrend.length > 0 ? sleepTrend[sleepTrend.length - 1]?.hours : "N/A"} hours
- Heart Rate Trend: ${heartRateTrend.length > 0 ? heartRateTrend[heartRateTrend.length - 1]?.bpm : "N/A"} bpm

Provide a VERY CONCISE assessment (max 150 words) with:
1. Quick summary of current status
2. Key areas needing improvement
3. Brief comparison to recent days
4. Top 2 actionable recommendations

**TABLE FORMAT REQUIREMENTS - FOLLOW EXACTLY:**
Create tables using this exact format:
| Metric | Today | Goal | Status |
|--------|-------|------|--------|
| Steps | 602 | 10,000 | Very Low |
| Sleep | 0 hrs | 7-9 hrs | Critical |

Do NOT use --- as separator rows. Use proper table headers with | characters only.
FOCUS ON TABLE FORMATTING

USE BOLD TEXT FOR THE SUBHEADINGS ONLY
THE CALORIES INDICATES THE AMOUNT OF CALORIES BURNED, NOT CONSUMED.
IF SLEEP AND HEART RATE VALUES ARE 0, DO NOT TAKE THAT INTO CONSIDERATION FOR WELLNESS ANALYSIS. 
`;

    const systemPrompt = `You are a concise Wellness Analyst. Provide brief, actionable insights in maximum 150 words. 
CRITICAL: Create tables using proper markdown format with | characters only. 
DO NOT use --- separator lines in tables. 
Table structure must be: | Header1 | Header2 | Header3 | followed by | row1 | data | data |
Keep tables compact and aligned properly. Focus on key improvements and trends.`;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ "google_search": {} }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    try {
      const res = await exponentialBackoffFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      const candidate = result.candidates?.[0];
      let modelText = "Sorry, I couldn't generate a response. Please check the console for API errors.";
      let sources = [];

      if (candidate && candidate.content?.parts?.[0]?.text) {
        modelText = candidate.content.parts[0].text;
        const groundingMetadata = candidate.groundingMetadata;
        if (groundingMetadata?.groundingAttributions) {
          sources = groundingMetadata.groundingAttributions
            .map(a => ({ uri: a.web?.uri, title: a.web?.title }))
            .filter(s => s.uri && s.title);
        }
      } else if (result.error) {
        modelText = `API Error: ${result.error.message}.`;
      }
      setAssessmentResult({ text: modelText, sources });
    } catch (e) {
      console.error(e);
      setAssessmentResult({ text: `Error fetching assessment: ${e.message}`, sources: [] });
    } finally {
      setIsAssessmentLoading(false);
    }
  }, [isLocalRun, stepCount, sleepHours, calories, distance, heartRate, hydration, hydrationGoal, stepsTrend, sleepTrend, heartRateTrend]);
  /** ---------------------------------------
   * Chatbot API Call - MODIFIED TO SAVE TO FIREBASE
   * -------------------------------------- */
    /** ---------------------------------------
   * Chatbot API Call - MODIFIED TO SAVE TO FIREBASE + IMAGE SUPPORT
   * -------------------------------------- */
  const callChatbotAPI = useCallback(
    async (newMessage, imageInlineData = null) => {
      const apiKey = isLocalRun ? GEMINI_API_KEY : "";
      if (!apiKey) {
        setError("GEMINI API ERROR: Missing API Key in local run. Cannot chat.");
        return;
      }
      setIsChatLoading(true);

      // Prepare history for API call (limit and convert format)
      const contents = [
        ...chatHistory,
        { role: 'user', text: newMessage, imageInlineData }
      ]
        .slice(-10) // Keep the last 10 messages for context
        .map(msg => {
          const parts = [];
          if (msg.text) {
            parts.push({ text: msg.text });
          }
          if (msg.imageInlineData) {
            parts.push({ inlineData: msg.imageInlineData });
          }
          return {
            role: msg.role === 'model' ? 'model' : 'user',
            parts
          };
        });

      const systemInstruction = {
        parts: [{
          text: `
You are a helpful and professional Health Navigator chatbot of VytalCare.

1. You are in a single continuous chat session.
   - The "contents" you receive include the full recent conversation history.
   - You MUST use that history for context when answering.

2. MEMORY / CONTEXT BEHAVIOUR (VERY IMPORTANT):
   - You CAN remember and refer to information the user told you earlier in THIS conversation.
   - This includes their name, age, conditions they mention, medications, and other details.
   - If the user asks things like "What is my name?" or "What did I just tell you?", answer using the information from earlier messages in this chat.
   - DO NOT say that you "cannot retain personal information", that "each interaction is fresh", or that you "do not remember previous messages". Within this chat, you DO have access to prior messages through the provided contents.

3. PRIVACY:
   - Do NOT invent or assume any personal details that were not explicitly given in the conversation.
   - Only use what is present in the chat history.

4. MEDICAL BEHAVIOUR:
   - Provide general, non-diagnostic information on medications, conditions, and health topics.
   - Always clearly state that your guidance is NOT a substitute for professional medical consultation and is for general information only.
   - Use Google Search (when available as a tool) for up-to-date medical and health context when needed.

5. IMAGE & PHOTO CLARITY (VERY IMPORTANT):
   - Users may send photos of wounds, rashes, skin issues, or medicine strips.
   - FIRST, briefly describe what you see in the image in simple language.
   - THEN, explain what it *could* be, giving a few possible explanations instead of a single diagnosis.
   - Clearly state that this is only an AI guess based on the photo and text, and that it is NOT a medical diagnosis.
   - Encourage the user to see a doctor or emergency service if the wound looks deep, infected (pus, spreading redness, fever), very painful, or if they are worried.
   - For medicine strips: try to identify the medicine name, common use, and important precautions, but remind users to double-check the strip and consult a professional before taking anything.
`
        }]
      };

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const payload = {
        contents,
        tools: [{ google_search: {} }],
        systemInstruction
      };

      // 1. Prepare and Save User Message to Firestore (text only)
      const userMessage = {
        role: 'user',
        text: newMessage,
        sources: [],
        createdAt: Date.now()
      };

      if (db && userId) {
        try {
          const chatCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/chats`);
          addDoc(chatCollectionRef, userMessage);
        } catch (e) {
          console.error("Error saving user message to Firestore:", e);
        }
      }

      // Optimistic UI update: add user message immediately
      setChatHistory(prev => [...prev, userMessage]);

      try {
        const res = await exponentialBackoffFetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        const candidate = result.candidates?.[0];
        let modelText = "Sorry, I couldn't generate a response. Please check the console for API errors.";

        if (candidate && candidate.content?.parts?.length) {
          modelText = candidate.content.parts.map(p => p.text || '').join('\n\n');
        } else if (result.error) {
          modelText = `API Error: ${result.error.message}.`;
        }

        const modelMessage = {
          role: 'model',
          text: modelText,
          sources: [],
          createdAt: Date.now()
        };

        // 2. Save Model Response Message to Firestore
        if (db && userId) {
          try {
            const chatCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/chats`);
            await addDoc(chatCollectionRef, modelMessage);
          } catch (e) {
            console.error("Error saving model message to Firestore:", e);
          }
        }

        // Optimistic UI update: add model message immediately
        setChatHistory(prev => [...prev, modelMessage]);

        // Speak response if enabled
        if (speechEnabled || isVoiceMode) {
          speakText(modelText);
        }

      } catch (e) {
        console.error("Chatbot API Error:", e);
        setChatHistory(prev => [
          ...prev,
          { role: 'model', text: `Error fetching response: ${e.message}`, sources: [], createdAt: Date.now() }
        ]);
        if (isVoiceMode) {
          speakText("I'm sorry, I encountered an error. Please try again.");
        }
      } finally {
        setIsChatLoading(false);
      }
    },
    [isLocalRun, chatHistory, db, userId, speechEnabled, speakText, isVoiceMode]
  );

  // Auto-scroll to bottom of chat
    // Auto-scroll to bottom of chat + file input ref
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null); // NEW: hidden file input for image upload
  const cameraInputRef = useRef(null); // NEW: hidden file input for taking a photo

  // === Camera modal state & refs ===
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const videoReff = useRef(null);   // <video> element inside the modal
  const canvasReff = useRef(null);  // hidden <canvas> used to grab a frame
  const [cameraStream, setCameraStream] = useState(null); // to stop camera later


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isChatLoading]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Allow only images
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (jpg, png, etc.)');
      event.target.value = '';
      return;
    }
    setAttachedImage(file);
  };

// ===== CAMERA HELPERS =====
const startCamera = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Camera is not supported in this browser.");
      setIsCameraModalOpen(false);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, // back camera on phones, normal cam on laptop
      audio: false
    });

    if (videoReff.current) {
      videoReff.current.srcObject = stream;
    }
    setCameraStream(stream);
  } catch (err) {
    console.error("Error starting camera:", err);
    alert("Could not access the camera. Check permissions and try again.");
    setIsCameraModalOpen(false);
  }
};

const stopCamera = () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    setCameraStream(null);
  }
};

// When the modal opens/closes, start/stop the camera
useEffect(() => {
  if (isCameraModalOpen) {
    startCamera();
  } else {
    stopCamera();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isCameraModalOpen]);

const handleCaptureFromCamera = () => {
  const video = videoReff.current;
  const canvas = canvasReff.current;
  if (!video || !canvas) return;

  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], "camera-photo.jpg", { type: "image/jpeg" });
    setAttachedImage(file);      // same state you use for uploaded images
    setIsCameraModalOpen(false); // close modal
  }, "image/jpeg", 0.9);
};


  const handleClearChat = () => {
    if (!window.confirm("Are you sure you want to clear the chat history?")) return;

    const now = Date.now();

    // Store a "clear marker" only on the client
    if (userId) {
      try {
        localStorage.setItem(`chatClearedAt_${userId}`, String(now));
      } catch (e) {
        console.error("Failed to persist chat clear marker:", e);
      }
    }

    // Immediately clear the visible chat in this session
    setChatHistory([INITIAL_CHAT_WELCOME]);
    setAttachedImage(null); // also clear any attached image
  };


  /** ---------------------------------------
   * Meds CRUD (unchanged)
   * -------------------------------------- */
  const handleNewMedChange = (e) => {
    const { name, value } = e.target;
    setNewMedication(prev => ({ ...prev, [name]: value }));
  };
  const handleTimeChange = (index, value) => {
    const cleanValue = value.replace(':', '').slice(0, 4);
    setNewMedication(prev => {
      const newTimes = [...prev.times];
      newTimes[index] = value;
      return { ...prev, times: newTimes };
    });
  };
  const handleAddTime = () => setNewMedication(prev => ({ ...prev, times: [...prev.times, '08:00'] }));
  const handleRemoveTime = (indexToRemove) => setNewMedication(prev => ({ ...prev, times: prev.times.filter((_, i) => i !== indexToRemove) }));

  const handleSaveMedication = async () => {
    const isConfigMissing = !firebaseConfig.apiKey;
    if (!db || !userId) {
      if (isLocalRun && isConfigMissing) {
        setError("Database Error: Provide Firebase config in FIREBASE_LOCAL_CONFIG to enable persistence.");
      } else {
        setError("Database not ready. Please wait for initialization or check Firebase setup.");
      }
      return;
    }
    if (!newMedication.name.trim() || !newMedication.dose.trim() || newMedication.times.every(t => !t.trim())) {
      setError('Please enter a name, dose, and at least one time.');
      return;
    }
    const validTimes = newMedication.times
      .map(t => t.trim())
      .filter(t => t.match(/^\d{2}:\d{2}$/))
      .sort();
    if (validTimes.length === 0) { setError('Use the time picker to select valid times.'); return; }

    const medicationData = {
      name: newMedication.name.trim(),
      dose: newMedication.dose.trim(),
      times: validTimes,
      createdAt: Date.now()
    };

    try {
      const medCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/medications`);
      await addDoc(medCollectionRef, medicationData);

      // >> NEW: Trigger n8n Webhook for scheduling/confirmation
      try {
        fetch('https://AdityaPrakash781-vytalcare-n8n.hf.space/webhook/new-medication', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            medName: newMedication.name,
            times: validTimes
          })
        });
      } catch (webhookError) {
        console.warn("Failed to trigger n8n webhook", webhookError);
        // We do not stop the app flow if the webhook fails, as the local save was successful
      }

      setNewMedication({ name: '', dose: '', times: ['08:00'] });
      setIsAdding(false);
      setError(null);
    } catch (e) {
      console.error("Error adding document: ", e);
      setError(`Failed to save medication: ${e.message}.`);
    }
  };

  const handleDeleteMedication = async (id) => {
    if (!db) return;
    const medDocRef = doc(db, `/artifacts/${appId}/users/${userId}/medications`, id);
    try { await deleteDoc(medDocRef); }
    catch (e) { console.error("Error deleting document: ", e); setError("Failed to delete medication."); }
  };

  // --- NEW AUTOMATIC LOGGING FUNCTION ---
  const handleMarkAsTaken = async (medItem) => {
    if (!db || !userId) return;

    try {
      const now = new Date();
      // 1. Create the Log (This automatically creates the 'medication_logs' collection!)
      await addDoc(collection(db, `/artifacts/${appId}/users/${userId}/medication_logs`), {
        userId: userId,
        medicationId: medItem.medId || "unknown", // Fallback if ID is missing
        medicationName: medItem.medName,
        scheduledTime: medItem.time,
        takenAt: now.toISOString(),
        status: 'taken',
        dateKey: getTodayDateKey() // Uses your existing date helper
      });

      // 2. Browser Notification (Immediate Feedback)
      new Notification("Great job!", {
        body: `You took ${medItem.medName} on time.`,
        icon: '/vite.svg'
      });

      // 3. (Optional) Optimistic UI update could go here
      // For now, we rely on the button disabling itself in the UI below or just alert
      alert(`Successfully logged ${medItem.medName} as taken!`);

    } catch (e) {
      console.error("Error logging medication:", e);
      alert("Failed to save log. Check console.");
    }
  };


  const todaySchedule = medications
    .flatMap(med => med.times.map(time => ({
      time: time,
      medName: med.name,
      dose: med.dose,
      medId: med.id,
      key: med.id + time,
    })))
    .sort((a, b) => a.time.localeCompare(b.time));

  /** ---------------------------------------
   * Renderers (unchanged)
   * -------------------------------------- */
  const renderMedicationForm = () => (
    <div className="p-6 rounded-2xl space-y-5 bg-surface border border-slate-100 shadow-sm animate-fade-in">
      <h3 className="text-lg font-bold text-text-main">Add New Medication</h3>

      <div className="space-y-3">
        <input
          type="text" name="name" value={newMedication.name} onChange={handleNewMedChange}
          placeholder="Medication Name (e.g., Vitamin D)"
          className="w-full p-3 border border-slate-200 rounded-xl placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-slate-50 focus:bg-white"
        />
        <input
          type="text" name="dose" value={newMedication.dose} onChange={handleNewMedChange}
          placeholder="Dose (e.g., 1000 IU or 1 tab)"
          className="w-full p-3 border border-slate-200 rounded-xl placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-slate-50 focus:bg-white"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2 text-text-muted">Daily Schedule Times</label>
        <div className="flex flex-wrap gap-3 items-center">
          {newMedication.times.map((time, index) => {
            // Convert 24hr time to 12hr format for display
            const get12HrFormat = (t) => {
              if (!t || t.length < 5) return '';
              const [h, m] = t.split(':').map(Number);
              if (isNaN(h) || isNaN(m)) return '';
              const ampm = h >= 12 ? 'PM' : 'AM';
              const hr12 = h % 12 || 12;
              return `${hr12}:${m.toString().padStart(2, '0')} ${ampm}`;
            };
            return (
              <div key={`time-input-${index}`} className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-800 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                <input
                  type="text"
                  value={time}
                  onChange={(e) => {
                    let val = e.target.value.replace(/[^0-9:]/g, '');
                    // Auto-insert colon after 2 digits
                    if (val.length === 2 && !val.includes(':')) {
                      val = val + ':';
                    }
                    // Limit to HH:MM format
                    if (val.length <= 5) {
                      handleTimeChange(index, val);
                    }
                  }}
                  placeholder="HH:MM"
                  maxLength={5}
                  pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
                  className="w-16 p-1.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md text-center text-sm focus:outline-none focus:border-primary dark:text-white font-mono"
                />
                {time && time.length === 5 && <span className="text-xs text-text-muted dark:text-slate-400">({get12HrFormat(time)})</span>}
                <button
                  onClick={() => handleRemoveTime(index)}
                  className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 transition-colors"
                  aria-label="Remove time"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          <button
            onClick={handleAddTime}
            className="flex items-center px-3 py-2 rounded-lg border border-dashed border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 transition-colors"
          >
            <Plus size={14} className="mr-1.5" /> Add Time
          </button>
        </div>
      </div>

      <div className="pt-2 flex justify-end">
        <button
          onClick={handleSaveMedication}
          className="flex items-center px-6 py-3 bg-primary text-white font-semibold rounded-xl shadow-md shadow-primary/20 hover:bg-primary-dark hover:-translate-y-0.5 transition-all duration-200"
        >
          <Bell size={18} className="mr-2" /> Save Medication
        </button>
      </div>
    </div>
  );

  const renderRemindersTab = () => {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Enrich schedule with status
    const scheduleWithStatus = todaySchedule.map(item => {
      let h, m;
      // Robust time parsing (HH:MM or HHMM legacy)
      if (item.time && item.time.includes(':')) {
        [h, m] = item.time.split(':').map(Number);
      } else if (item.time && item.time.length === 4) {
        h = parseInt(item.time.substring(0, 2), 10);
        m = parseInt(item.time.substring(2, 4), 10);
      } else {
        h = 0; m = 0;
      }
      if (isNaN(h)) h = 0;
      if (isNaN(m)) m = 0;

      const itemMinutes = h * 60 + m;
      const uniqueKey = `${item.medId}_${item.time}`;
      const isTaken = takenMedications.has(uniqueKey);

      // "Missed" logic: Not taken AND > 15 mins passed
      // diffMinutes < -15 means scheduled time was more than 15 mins ago
      const diffMinutes = itemMinutes - currentMinutes;
      const isMissed = !isTaken && diffMinutes < -15;
      const isPast = itemMinutes < currentMinutes;

      return { ...item, itemMinutes, diffMinutes, isTaken, isMissed, isPast, uniqueKey };
    }).sort((a, b) => a.itemMinutes - b.itemMinutes);

    // Up Next: First item that is NOT taken AND NOT missed
    // (If it's missed, it stays in timeline with red dot. Up Next moves to future.)
    const nextDose = scheduleWithStatus.find(item => !item.isTaken && !item.isMissed);

    return (
      <div className="space-y-8 p-6 animate-fade-in">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-2xl font-bold text-text-main dark:text-white flex items-center">
            <Bell size={28} className="mr-3 text-primary" />
            Medication Reminders
          </h2>
          <button
            onClick={() => setIsAdding(!isAdding)}
            className={`flex items-center px-4 py-2 rounded-xl font-medium transition-all duration-200 ${isAdding ? 'bg-slate-100 text-text-muted hover:bg-slate-200' : 'bg-primary text-white shadow-md shadow-primary/20 hover:bg-primary-dark'}`}
          >
            {isAdding ? <X size={18} className="mr-2" /> : <Plus size={18} className="mr-2" />}
            {isAdding ? 'Close Form' : 'Add Medication'}
          </button>
        </div>

        {isAdding && renderMedicationForm()}

        {/* Next Dose Card */}
        {nextDose && (
          <div className="bg-gradient-to-r from-primary to-teal-600 rounded-3xl p-6 text-white shadow-lg shadow-primary/20 animate-slide-up">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-primary-100 font-medium mb-1">Up Next</p>
                <h3 className="text-3xl font-bold">{nextDose.medName}</h3>
                <p className="text-white/80 mt-1 flex items-center">
                  <span className="bg-white/20 px-2 py-0.5 rounded-lg text-sm mr-2">{nextDose.dose}</span>
                  at {formatTimeWithBoth(nextDose.time).time24}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                <Clock size={32} className="text-white" />
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-white/10 flex justify-between items-center">
              <p className="text-sm font-medium">
                {nextDose.diffMinutes < 0
                  ? `Due now (${Math.abs(nextDose.diffMinutes)}m ago)`
                  : `Due in ${Math.floor(nextDose.diffMinutes / 60)}h ${nextDose.diffMinutes % 60}m`
                }
              </p>
              <button
                onClick={() => handleMarkAsTaken(nextDose)}
                className="px-4 py-2 bg-white text-primary font-bold rounded-xl text-sm hover:bg-slate-50 transition-colors shadow-sm"
              >
                Mark as Taken
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Timeline Column */}
          <div className="lg:col-span-2 space-y-6">
            <h3 className="text-lg font-bold flex items-center text-text-main dark:text-white">
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mr-3 text-primary">
                <Calendar size={18} />
              </div>
              Today's Timeline
            </h3>

            {isLoading ? (
              <LoadingSpinner />
            ) : scheduleWithStatus.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                <Bell size={48} className="mx-auto mb-3 text-slate-300" />
                <p className="text-text-muted italic">No medications scheduled for today.</p>
              </div>
            ) : (
              <div className="relative pl-8 space-y-8 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200 dark:before:bg-slate-700">
                {scheduleWithStatus.map((item) => {
                  // Visual Logic
                  // Taken: Green dot, opacity normal
                  // Missed: Red dot, opacity normal
                  // Pending: Primary/Gray dot
                  let dotColor = 'bg-primary';
                  if (item.isTaken) dotColor = 'bg-green-500 border-green-500';
                  else if (item.isMissed) dotColor = 'bg-red-500 border-red-500';
                  else if (item.isPast) dotColor = 'bg-slate-300 border-slate-300'; // Past but not missed (e.g. < 15m or handled by logic) - actually logic says >15m is missed. 0-15m is overdue (Primary).

                  return (
                    <div key={item.uniqueKey} className="relative group">
                      {/* Timeline Dot */}
                      <div className={`absolute -left-[39px] top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-4 border-white dark:border-slate-900 shadow-sm z-10 ${dotColor}`} />

                      <div className={`flex items-center justify-between p-5 rounded-2xl border transition-all duration-200 
                        ${item.isTaken
                          ? 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30'
                          : item.isMissed
                            ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30'
                            : item.isPast
                              ? 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                              : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-primary/30'
                        }`}>
                        <div className="flex items-center gap-5">
                          <div className={`text-xl font-mono font-bold ${item.isTaken ? 'text-green-600' : item.isMissed ? 'text-red-500' : item.isPast ? 'text-slate-400' : 'text-primary'}`}>
                            {formatTimeWithBoth(item.time).time24}
                            <div className="text-xs font-normal text-text-muted dark:text-slate-400">({formatTimeWithBoth(item.time).time12})</div>
                          </div>
                          <div>
                            <p className={`text-lg font-bold ${item.isTaken ? 'text-green-700 dark:text-green-400' : item.isMissed ? 'text-red-700 dark:text-red-400' : 'text-text-main dark:text-white'}`}>
                              {item.medName}
                              {item.isTaken && <span className="ml-2 text-xs bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-100 px-2 py-0.5 rounded-full">Taken</span>}
                            </p>
                            <p className="text-sm text-text-muted dark:text-slate-400 flex items-center">
                              <span className={`w-1.5 h-1.5 rounded-full mr-2 ${item.isTaken ? 'bg-green-400' : 'bg-secondary'}`}></span>
                              {item.dose}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {!item.isTaken && item.isMissed && (
                            <button
                              onClick={() => handleMarkAsTaken(item)}
                              className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                            >
                              Mark as Taken
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteMedication(item.medId)}
                            className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                            aria-label="Delete medication"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* All Medications Sidebar */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-text-main dark:text-white">All Prescriptions</h3>
            {medications.length === 0 ? (
              <p className="text-text-muted italic text-sm">You have no saved medications.</p>
            ) : (
              <div className="space-y-3">
                {medications.map(med => (
                  <div key={med.id} className="p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 hover:border-primary/30 transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-bold text-text-main dark:text-white">{med.name}</p>
                      <button
                        onClick={() => handleDeleteMedication(med.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-xs text-text-muted dark:text-slate-400 mb-2">{med.dose}</p>
                    <div className="flex flex-wrap gap-1">
                      {med.times.map(t => (
                        <span key={t} className="text-[10px] bg-slate-50 dark:bg-slate-700 text-text-muted dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-600 font-mono flex flex-col items-center">
                          <span>{formatTimeWithBoth(t).time24}</span>
                          <span className="text-[8px] opacity-70">({formatTimeWithBoth(t).time12})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderActivityTab = () => (
    <div className="p-6 space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-100 dark:border-slate-700 pb-4">
        <h2 className="text-2xl font-bold text-text-main dark:text-white flex items-center">
          <Activity size={28} className="mr-3 text-primary" />
          Activity Dashboard
        </h2>
        <div className="mt-4 md:mt-0 flex space-x-3">
          <button
            onClick={!isSyncingAll ? (() => { setIsAutoSyncActive(true); syncAll(); }) : undefined}
            className={`px-5 py-2.5 bg-primary text-white font-semibold rounded-xl shadow-md shadow-primary/20 transition-all duration-200 flex items-center ${isSyncingAll ? "opacity-70 cursor-wait" : "hover:bg-primary-dark hover:-translate-y-0.5"}`}
          >
            <Activity size={18} className={`mr-2 ${isSyncingAll ? 'animate-spin' : ''}`} />
            {isSyncingAll ? "Syncing..." : "Sync Data"}
          </button>
          <button
            onClick={!isAssessmentLoading ? callAssessmentAPI : undefined}
            className={`px-5 py-2.5 bg-secondary text-white font-semibold rounded-xl shadow-md shadow-secondary/20 transition-all duration-200 flex items-center ${isAssessmentLoading ? "opacity-70 cursor-wait" : "hover:bg-secondary-dark hover:-translate-y-0.5"}`}
            disabled={
              isAssessmentLoading ||
              (stepCount ?? null) === null &&
              (sleepHours ?? null) === null &&
              (calories ?? null) === null &&
              (distance ?? null) === null &&
              (heartRate ?? null) === null
            }
          >
            <MessageSquare size={18} className="mr-2" />
            {isAssessmentLoading ? 'Analyzing...' : 'AI Insight'}
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Steps Card */}
        <div
          onClick={() => scrollToGraph('steps')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#0F766E]/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('steps'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-primary/70 hover:text-primary"
          >
            <Info size={18} />
          </button>
          {stepCount !== null ? (
            <>
              <StepCompletionRing steps={stepCount} goal={DAILY_STEP_GOAL} size={160} />
              <div className="mt-2 text-center z-10">
                <p className="text-3xl font-bold text-text-main dark:text-white">{stepCount.toLocaleString()}</p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Steps Today</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <Activity size={48} className="mx-auto mb-3 text-slate-300" />
              <p>No step data</p>
            </div>
          )}
        </div>

        {/* Sleep Card */}
        <div
          onClick={() => scrollToGraph('sleep')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-50 dark:bg-indigo-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('sleep'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-indigo-500/70 hover:text-indigo-500"
          >
            <Info size={18} />
          </button>
          {sleepHours !== null ? (
            <>
              <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 mb-4 ${sleepHours < RECOMMENDED_SLEEP_HOURS ? 'border-secondary/30 bg-secondary/5 dark:bg-secondary/10' : 'border-green-100 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20'}`}>
                <Moon size={32} className={sleepHours < RECOMMENDED_SLEEP_HOURS ? 'text-secondary' : 'text-green-600'} />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{sleepHours}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">h</span></p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Sleep Duration</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <Moon size={48} className="mx-auto mb-3 text-slate-300" />
              <p>No sleep data</p>
            </div>
          )}
        </div>

        {/* Calories Card */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 dark:bg-orange-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('calories'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-orange-500/70 hover:text-orange-500"
          >
            <Info size={18} />
          </button>
          {calories !== null ? (
            <>
              <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/40 rounded-2xl flex items-center justify-center mb-4 text-orange-600 dark:text-orange-400">
                <Activity size={32} />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{calories}</p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Calories Burned</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <p>No calorie data</p>
            </div>
          )}
        </div>


        {/* Hydration Card */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-50 dark:bg-cyan-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('hydration'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-cyan-500/70 hover:text-cyan-500"
          >
            <Info size={18} />
          </button>

          <div className="w-16 h-16 bg-cyan-100 dark:bg-cyan-900/40 rounded-2xl flex items-center justify-center mb-4 text-cyan-600 dark:text-cyan-400">
            <Droplet size={32} fill="currentColor" />
          </div>

          <div className="text-center z-10 w-full">
            <p className="text-4xl font-bold text-text-main dark:text-white">{hydration}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">ml</span></p>
            <p className="text-sm text-text-muted dark:text-slate-400 font-medium mb-4">Water Intake</p>

            {/* Progress Bar */}
            <div className="w-full bg-slate-100 rounded-full h-2.5 mb-4 overflow-hidden">
              <div
                className="bg-cyan-500 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (hydration / hydrationGoal) * 100)}%` }}
              ></div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); updateHydration(-250); }}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                disabled={hydration <= 0}
              >
                <Minus size={18} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); updateHydration(250); }}
                className="flex items-center px-4 py-2 bg-cyan-500 dark:bg-cyan-700/80 text-white rounded-xl font-semibold shadow-md shadow-cyan-200 dark:shadow-cyan-900/20 hover:bg-cyan-600 dark:hover:bg-cyan-600/80 transition-colors"
              >
                <Plus size={16} className="mr-1" /> 250ml
              </button>
            </div>
          </div>
        </div>

        {/* Distance Card */}
        <div
          onClick={() => scrollToGraph('distance')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 dark:bg-blue-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />

          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('distance'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-blue-500/70 hover:text-blue-500"
          >
            <Info size={18} />
          </button>

          {distance !== null ? (
            <>
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/40 rounded-2xl flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400">
                <Activity size={32} />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{distance}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">km</span></p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Distance</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <p>No distance data</p>
            </div>
          )}
        </div>

        {/* Heart Rate Card */}
        <div
          onClick={() => scrollToGraph('heartRate')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 dark:bg-red-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />

          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('heartRate'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-red-500/70 hover:text-red-500"
          >
            <Info size={18} />
          </button>

          {heartRate !== null ? (
            <>
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 rounded-2xl flex items-center justify-center mb-4 text-red-600 dark:text-red-400 animate-pulse">
                <Heart size={32} fill="currentColor" />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{heartRate}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">bpm</span></p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Heart Rate</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <Heart size={48} className="mx-auto mb-3 text-slate-300" />
              <p>No heart rate data</p>
            </div>
          )}
        </div>
      </div>
      {/* Health Score Card */}
      <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md
     transition-shadow w-full flex justify-center">

        {/* CENTERED ROW WRAPPER */}
        <div className="flex flex-row items-center justify-center gap-16 max-w-3xl w-full">

          {/* LEFT — RING */}
          <div className="flex-shrink-0">
            <HealthScoreRing score={healthScore ?? 0} />
          </div>

          {/* RIGHT — TEXT */}
          <div className="flex flex-col space-y-6 text-left">

            {/* WHY THIS SCORE */}
            {healthScoreExplanation.length > 0 && (
              <div>
                <p className="font-semibold text-text-main dark:text-white text-lg mb-2">Why this score:</p>
                <ul className="space-y-1 text-text-muted dark:text-slate-400 text-sm">
                  {healthScoreExplanation.map((line, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-lg">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* HOW TO IMPROVE */}
            {healthScoreSuggestions.length > 0 && (
              <div>
                <p className="font-semibold text-text-main dark:text-white text-lg mb-2">How to improve:</p>
                <ul className="space-y-1 text-text-muted dark:text-slate-400 text-sm">
                  {healthScoreSuggestions.map((line, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-lg">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>

        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
        <div ref={heartRateRef} className={`bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 ${highlightedGraph === 'heartRate' ? 'glow-red' : ''}`}>
          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Heart size={25} className="mr-2 text-secondary" /> Heart Rate Trend
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={heartRateTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ color: '#0F766E' }}
              />
              <Line type="monotone" dataKey="bpm" stroke="#FB7185" strokeWidth={3} dot={{ r: 4, fill: '#FB7185', strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div ref={stepsRef} className={`bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 ${highlightedGraph === 'steps' ? 'glow-teal' : ''}`}>
          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Footprints size={25} color="#0F766E" className="mr-2 text-secondary" />Steps Trend
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={steps3hTrend}>

              <defs>
                <linearGradient id="stepsGradientFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0F766E" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#0F766E" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#a1a3a4ff" />

              <XAxis dataKey="time" stroke="#94a3b8" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} fontSize={12} />

              <Tooltip
                formatter={(value, name) => {
                  if (name === "steps") {
                    return [`${value} steps`, "Steps"];
                  }
                  return null;
                }}
                contentStyle={{
                  backgroundColor: "#fff",
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.06)"
                }}
              />

              {/* MAIN LINE */}
              <Line
                type="monotone"
                dataKey="steps"
                stroke="#0F766E"
                strokeWidth={4}
                dot={false}
              />

              {/* GRADIENT FILL UNDER LINE */}
              <Area
                type="monotone"
                dataKey="stepsArea"
                stroke="none"
                fill="url(#stepsGradientFill)"
                fillOpacity={1}
              />

            </LineChart>
          </ResponsiveContainer>

        </div>
        <div ref={distanceRef} className={`relative bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 
                hover:shadow-md transition-shadow overflow-hidden ${highlightedGraph === 'distance' ? 'glow-blue' : ''}`}>

          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Ruler size={25} color='#14b8a6' className="mr-2 text-secondary" />Distance Trend
          </h3>

          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={weeklyDistance}
              barSize={36}
              margin={{ top: 20, right: 10, left: -10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />

              <XAxis
                dataKey="day"
                tick={{ fill: "#64748b", fontSize: 12, fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
              />

              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                unit=" km"
              />

              <Tooltip
                cursor={{ fill: "rgba(20,184,166,0.08)" }}
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.06)"
                }}
                labelStyle={{ fontWeight: 600 }}
                formatter={(value) => [`${value} km`, "Distance"]}
              />

              <Bar
                dataKey="km"
                radius={[10, 10, 0, 0]}
                fill="#14b8a6"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div ref={sleepRef} className={`bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 ${highlightedGraph === 'sleep' ? 'glow-indigo' : ''}`}>
          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Moon size={25} color="#6366F1" className="mr-2 text-secondary" />Sleep Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={sleepTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "#64748b", fontSize: 12, fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 12]}
                ticks={[0, 3, 6, 9, 12]}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                unit=" hrs"
                stroke="#E2E8F0" />
              <Tooltip
                cursor={{ fill: "#EEF2FF" }}
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid #E2E8F0",
                  background: "white",
                  padding: "10px 14px"
                }} />
              <Bar
                dataKey="hours"
                radius={[10, 10, 0, 0]}
                fill="#6366F1"
                barSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI Assessment Report */}
      {
        (isAssessmentLoading || assessmentResult) && (
          <div className="mt-8 bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-lg border border-slate-100 dark:border-slate-700 animate-slide-up">
            <h3 className="text-2xl font-bold flex items-center mb-6 text-text-main">
              <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center mr-3">
                <MessageSquare size={20} className="text-secondary" />
              </div>
              Wellness Analysis
            </h3>

            {isAssessmentLoading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-secondary rounded-full animate-spin mb-4" />
                <p className="text-text-muted animate-pulse">Generating insights...</p>
              </div>
            )}

            {assessmentResult && !isAssessmentLoading && (
              <div className="space-y-6">
                <div className="prose prose-slate max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: assessmentResult.text
                      .replace(/^### (.*$)/gim, '<h3 class="text-xl font-bold text-primary mt-6 mb-3">$1</h3>')
                      .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold text-text-main mt-8 mb-4">$1</h2>')
                      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-text-main">$1</strong>')
                      .replace(/^\s*[-•]\s+(.*)$/gim, '<li class="ml-4 mb-2 text-text-muted list-disc">$1</li>')
                      .replace(/\n/g, '<br/>')
                  }}
                />

                {assessmentResult.sources && assessmentResult.sources.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <p className="font-semibold text-sm text-text-muted mb-3 uppercase tracking-wider">Sources</p>
                    <div className="flex flex-wrap gap-2">
                      {assessmentResult.sources.map((source, idx) => (
                        <a key={idx} href={source.uri} target="_blank" rel="noopener noreferrer"
                          className="flex items-center px-3 py-1.5 bg-slate-50 rounded-lg text-xs text-primary hover:bg-primary/5 hover:underline transition-colors border border-slate-100">
                          <Link size={12} className="mr-1.5" />
                          <span className="max-w-[200px] truncate">{source.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      }
    </div >
  );


  const renderChatbotTab = () => {
    // Read the last clear timestamp from localStorage
    const clearedAtKey = userId ? `chatClearedAt_${userId}` : null;
    const clearedAt = clearedAtKey ? Number(localStorage.getItem(clearedAtKey) || 0) : 0;

    const rawMessages = Array.isArray(chatHistory) ? chatHistory : [];

    // Only show messages created AFTER the last clear time
    let visibleMessages = rawMessages.filter(msg => {
      // If createdAt is missing (e.g., INITIAL_CHAT_WELCOME), always show it
      if (!msg.createdAt) return true;
      return msg.createdAt > clearedAt;
    });

    // If nothing is visible, fall back to the welcome message
    if (visibleMessages.length === 0) {
      visibleMessages = [INITIAL_CHAT_WELCOME];
    }

    return (
      <div className="flex flex-col h-[70vh] p-6 animate-fade-in relative">
        {/* Voice Mode Overlay */}
        {isVoiceMode && (
          <div className="absolute inset-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center p-8 rounded-3xl animate-fade-in">
            <div className="relative mb-8">
              <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${isSpeaking ? 'bg-primary/20 scale-110' : isListening ? 'bg-red-500/10 scale-100' : 'bg-slate-100 dark:bg-slate-800'}`}>
                <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isSpeaking ? 'bg-primary text-white shadow-lg shadow-primary/30' : isListening ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}>
                  {isSpeaking ? <Volume2 size={48} /> : isListening ? <Mic size={48} /> : <MicOff size={48} />}
                </div>
              </div>
              {/* Ripple effects */}
              {isListening && (
                <>
                  <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping" style={{ animationDuration: '2s' }} />
                  <div className="absolute inset-0 rounded-full border-4 border-red-500/20 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
                </>
              )}
            </div>

            <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
              {isSpeaking ? "Speaking..." : isListening ? "Listening..." : "Processing..."}
            </h3>
            <p className="text-text-muted dark:text-slate-400 text-center max-w-md mb-8">
              {isSpeaking ? "The AI is responding to you." : isListening ? "Go ahead, I'm listening." : "Please wait a moment."}
            </p>

            <button
              onClick={stopVoiceMode}
              className="px-8 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-text-main dark:text-white rounded-xl font-semibold transition-colors flex items-center gap-2"
            >
              <X size={20} /> Exit Voice Mode
            </button>
          </div>
        )}

                        <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-700 mb-4">
          {/* Left: Title + Voice/Language controls */}
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-text-main dark:text-white flex items-center">
              <MessageSquare size={28} className="mr-3 text-primary" />
              Health Chatbot
            </h2>

            {/* Voice Controls */}
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {/* Voice Mode Toggle */}
              <button
                onClick={isVoiceMode ? stopVoiceMode : startVoiceMode}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-all text-xs font-semibold ${
                  isVoiceMode
                    ? 'bg-red-500 text-white shadow-sm animate-pulse'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
                }`}
                title={isVoiceMode ? "Exit Voice Mode" : "Start Voice Conversation"}
              >
                {isVoiceMode ? <MicOff size={14} /> : <Mic size={14} />}
                {isVoiceMode ? "Exit Voice" : "Voice Mode"}
              </button>

              <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-600 mx-1"></div>

              {/* Mute / TTS toggle */}
              <button
                onClick={() => {
                  setSpeechEnabled(!speechEnabled);
                  if (speechEnabled) stopSpeaking();
                }}
                className={`p-1.5 rounded-md transition-all ${
                  speechEnabled
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
                title={speechEnabled ? "Disable Text-to-Speech" : "Enable Text-to-Speech"}
              >
                {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>

              <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-600 mx-1"></div>

              {/* Language selector */}
              <div className="relative group">
                <button className="flex items-center gap-1 p-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-md transition-colors">
                  <Globe size={14} />
                  {LANGUAGES.find(l => l.code === selectedLanguage)?.code
                    .split('-')[0]
                    .toUpperCase()}
                </button>

                {/* Language Dropdown */}
                <div className="absolute top-full right-0 mt-1 w-40 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 overflow-hidden z-50 hidden group-hover:block">
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLanguage(lang.code)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                        selectedLanguage === lang.code
                          ? 'text-primary font-bold bg-primary/5'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {lang.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Clear button */}
          <button
            onClick={handleClearChat}
            className="ml-auto text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center border border-red-100"
            title="Clear Chat History"
          >
            <Trash2 size={14} className="mr-1" /> Clear
          </button>
        </div>


        <div className="flex-grow overflow-y-auto space-y-6 pr-2 mb-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
          {visibleMessages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 ${msg.role === 'user' ? 'bg-primary ml-3' : 'bg-secondary/10 mr-3'}`}>
                  {msg.role === 'user'
                    ? <Activity size={16} className="text-white" />
                    : <MessageSquare size={16} className="text-secondary" />}
                </div>
                <div
                  className={`p-4 rounded-2xl shadow-sm text-sm leading-relaxed ${msg.role === 'user'
                    ? 'bg-primary text-white rounded-tr-none'
                    : 'bg-slate-50 dark:bg-slate-800 text-text-main dark:text-slate-100 border border-slate-100 dark:border-slate-700 rounded-tl-none'
                    }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            </div>
          ))}

          {isChatLoading && (
            <div className="flex justify-start">
              <div className="flex max-w-[85%] flex-row">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center mt-1 mr-3">
                  <MessageSquare size={16} className="text-secondary" />
                </div>
                <div className="p-4 rounded-2xl rounded-tl-none bg-slate-50 border border-slate-100 shadow-sm">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

                <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = chatInput.trim();

            // Don't send empty message with no image
            if (!trimmed && !attachedImage) return;

            // Capture current values before clearing state
            const messageToSend = trimmed || (attachedImage ? "Please help me understand this photo." : "");
            const imageFile = attachedImage || null;

            // Clear UI fields
            setChatInput('');
            setAttachedImage(null);

            if (imageFile) {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                const imageInlineData = {
                  data: base64,
                  mimeType: imageFile.type || "image/jpeg",
                };
                callChatbotAPI(messageToSend, imageInlineData);
              };
              reader.readAsDataURL(imageFile);
            } else {
              callChatbotAPI(messageToSend, null);
            }
          }}
          className="relative mt-2"
        >
          {/* Attached image preview */}
          {attachedImage && (
            <div className="flex items-center gap-3 mb-2 px-2">
              <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                <img
                  src={URL.createObjectURL(attachedImage)}
                  alt="Attached preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 text-xs text-text-muted dark:text-slate-400">
                <div className="font-semibold text-text-main dark:text-slate-100 mb-0.5">
                  {attachedImage.name}
                </div>
                <div>
                  Image attached. You can also type extra details before sending.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAttachedImage(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Remove
              </button>
            </div>
          )}

          <div className="relative w-full">
            {/* Mic Button - Left */}
            <button
              type="button"
              onClick={toggleListening}
              className={`absolute left-2 top-2 bottom-2 w-10 flex items-center justify-center rounded-xl transition-all duration-200 ${
                isListening
                  ? 'bg-red-500 text-white animate-pulse shadow-md'
                  : 'text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title={isListening ? "Stop Listening" : "Start Voice Input"}
            >
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {/* Hidden file input */}
            <input
              type="file"
              accept="image/*"
              capture="environment" 
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Hidden file input for camera */}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={cameraInputRef}
                className="hidden"
                onChange={handleFileChange}
              />

            {/* Text input */}
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                isListening
                  ? "Listening..."
                  : "Ask a health question or upload a photo"
              }
              className={`w-full p-4 pl-14 pr-32 border rounded-2xl placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm ${
                isListening
                  ? 'border-red-300 bg-red-50/50 dark:bg-red-900/20'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
              }`}
            />

            {/* Right-side buttons (attach + send) */}
            <div className="absolute right-2 top-2 bottom-2 flex items-center gap-2">
              {/* Attach image button */}
              <button
                type="button"
                onClick={() => setShowAttachMenu(prev => !prev)} // NEW: toggle menu
                className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="Upload/Take photo"
              >
                <Paperclip size={18} />
              </button>

              {showAttachMenu && (
                  <div className="absolute right-12 top-0 mt-1 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 z-50 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        if (fileInputRef.current) fileInputRef.current.click(); // open file browser
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-t-xl"
                    >
                      Upload from computer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        setIsCameraModalOpen(true);   
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-b-xl border-t border-slate-100 dark:border-slate-700"
                    >
                      Take a photo
                    </button>
                  </div>
                )}


              {/* Send button */}
              <button
                type="submit"
                disabled={(!chatInput.trim() && !attachedImage) || isChatLoading}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 ${
                  (!chatInput.trim() && !attachedImage) || isChatLoading
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-primary text-white shadow-md hover:shadow-lg hover:-translate-y-0.5'
                }`}
              >
                {isChatLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>
          </div>
        </form>
                {isCameraModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 w-full max-w-md shadow-2xl flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-text-main dark:text-slate-100 mb-1">
                Take a photo
              </h3>

              {/* Live video preview */}
              <div className="relative w-full rounded-xl overflow-hidden bg-black aspect-video">
                <video
                  ref={videoReff}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Hidden canvas just for capturing the frame */}
              <canvas ref={canvasReff} className="hidden" />

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick= {() => {
                  stopCamera();
                  setIsCameraModalOpen(false); }}
                  className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCaptureFromCamera}
                  className="px-3 py-2 text-xs rounded-xl bg-primary text-white font-semibold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
                >
                  Capture
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  /** ---------------------------------------
   * Error banner (unchanged)
   * -------------------------------------- */

  const renderEmergencyTab = () => (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center mb-6">
        <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mr-4">
          <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-main dark:text-white">Emergency Contacts</h2>
          <p className="text-text-muted dark:text-slate-400">Quick access to emergency services</p>
        </div>
      </div>

      <div className="grid gap-4">
        {[
          { label: 'Personal Emergency', number: '+919353305251' },
          { label: 'Ambulance Service', number: '108' }
        ].map((contact, idx) => (
          <div key={idx} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-muted dark:text-slate-400 mb-1">{contact.label}</p>
              <p className="text-xl font-bold text-text-main dark:text-white tracking-wide">{contact.number}</p>
            </div>
            <div className="flex gap-3">
              <a
                href={`tel:${contact.number}`}
                className="flex-1 sm:flex-none px-6 py-3 bg-green-500 dark:bg-green-700/80 hover:bg-green-600 dark:hover:bg-green-600/80 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-green-200 dark:shadow-green-900/20"
              >
                <Phone size={18} />
                Call
              </a>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contact.number);
                  alert(`Copied ${contact.number} to clipboard`);
                }}
                className="flex-1 sm:flex-none px-6 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <Copy size={18} />
                Copy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderError = () => {
    if (!error) return null;
    const isSuccess = typeof error === 'object' && error.type === 'success';
    const messageText = isSuccess ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));

    return (
      <div className={`p-4 rounded-xl mb-6 flex items-center justify-between border ${isSuccess ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
        <span className="font-medium">{isSuccess ? 'Success: ' : 'Error: '}{messageText}</span>
        <button onClick={() => setError(null)} className="hover:opacity-70 transition-opacity"><X size={20} /></button>
      </div>
    );
  };



  // =====================RENDER INFO================================
  const renderInfoModal = () => {
    if (!activeInfoMetric) return null;
    const info = METRIC_INFO[activeInfoMetric];

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setActiveInfoMetric(null)}>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-2xl max-w-sm w-full border border-slate-100 dark:border-slate-700 transform transition-all scale-100 relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setActiveInfoMetric(null)} className="absolute top-4 right-4 p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-text-muted">
            <X size={20} />
          </button>
          <div className="flex items-center mb-4">
            <div className="p-3 bg-primary/10 rounded-xl mr-3">
              <Info className="text-primary" size={24} />
            </div>
            <h3 className="text-xl font-bold text-text-main dark:text-white">{info.title}</h3>
          </div>
          <p className="text-text-muted dark:text-slate-300 leading-relaxed text-sm">
            {info.desc}
          </p>
          <button
            onClick={() => setActiveInfoMetric(null)}
            className="mt-6 w-full py-3 bg-primary text-white rounded-xl font-semibold shadow-lg shadow-primary/20 hover:bg-primary-dark transition-all"
          >
            Got it
          </button>
        </div>
      </div>
    );
  };


  // =========================================================

  /** ---------------------------------------
   * Render (unchanged)
   * -------------------------------------- */
  if (!googleAccessToken) return <LoginPage handleLogin={handleLogin} error={error} />;

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-background dark:bg-slate-950 text-text-main dark:text-slate-100 font-sans">
      <ColorBlindFilters />
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 pb-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center mb-4 md:mb-0">
            <div className="w-25 h-25 rounded-xl flex items-center justify-center mr-3">
              <img
                src={appIcon}
                alt="VytalCare Logo"
                className="w-10 h-10 object-contain"
                style={{ width: "50px", height: "50px", marginRight: "10px" }}
              />
            </div>

            <h1 className="text-3xl font-bold text-text-main dark:text-white tracking-tight"
              style={{ marginLeft: "-15px" }}>
              VytalCare

            </h1>


          </div>

          <div className="flex bg-white dark:bg-slate-800 p-1.5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
            {[
              { id: 'reminders', icon: Bell, label: 'Reminders' },
              { id: 'activity', icon: Activity, label: 'Activity' },
              { id: 'chatbot', icon: MessageSquare, label: 'Chatbot' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-5 py-2.5 rounded-xl font-medium transition-all duration-200 ${activeTab === tab.id
                  ? 'bg-primary text-white shadow-md shadow-primary/20'
                  : 'text-text-muted dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/30 hover:text-text-main dark:hover:text-slate-200'
                  }`}
              >
                <tab.icon size={18} className="mr-2" />
                {tab.label}
              </button>
            ))}
          </div>
          <button
            className="mt-2 px-5 py-2.5 bg-red-500 dark:bg-red-800/80 text-white font-semibold rounded-xl shadow-md shadow-red-300 dark:shadow-red-900/30
        hover:bg-red-400 dark:hover:bg-red-700/80 transition-all duration-200 flex items-center gap-2
        "
            onClick={() => setActiveTab('emergency')}
          >
            🚑 EMERGENCY
          </button>
        </div>

        {renderError()}

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Left Sidebar - Profile */}
          <div className="w-full lg:w-80 flex-shrink-0 h-auto">
            <ProfileSection
              db={db}
              userId={userId}
              appId={appId}
              theme={theme}
              setTheme={setTheme}
              colorBlindMode={colorBlindMode}
              setColorBlindMode={setColorBlindMode}
            />
          </div>

          {/* Main Content */}
          <div className="flex-grow bg-surface dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none min-h-[60vh] border border-slate-100 dark:border-slate-800 overflow-hidden">
            {activeTab === 'reminders' && renderRemindersTab()}
            {activeTab === 'activity' && renderActivityTab()}
            {activeTab === 'chatbot' && renderChatbotTab()}
            {activeTab === 'emergency' && renderEmergencyTab()}
          </div>
        </div>
        {renderInfoModal()}
      </div>
    </div>
  );
};

export default App;