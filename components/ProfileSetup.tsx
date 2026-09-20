"use client";

import { useState } from "react";
import { BACKEND_URL } from "@/lib/api-config";
import { syncIdentityKeyLifecycle } from "@/lib/crypto";

type ProfileSetupProps = {
  userId?: string | null;

  onComplete: (profile: {
    userId?: string;
    username: string;
    age: number;
    gender: string;
    avatar: string;
  }) => void;
};

const avatars = [
  "🐶",
  "🐱",
  "🦊",
  "🐸",
  "🐼",
  "🐨",
];

export default function ProfileSetup({
  userId,
  onComplete,
}: ProfileSetupProps) {
  // ==========================================
  // PROFILE STATE
  // ==========================================

  const [username, setUsername] =
    useState("");

  const [age, setAge] =
    useState("");

  const [gender, setGender] =
    useState("");

  const [avatar, setAvatar] =
    useState("🐶");

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  // ==========================================
  // SUBMIT PROFILE
  // ==========================================

  const handleSubmit = async () => {
    setError("");

    // ==========================================
    // USERNAME VALIDATION
    // ==========================================

    const trimmedUsername =
      username.trim();

    if (!trimmedUsername) {
      setError(
        "Please enter a username.",
      );
      return;
    }

    if (trimmedUsername.length < 3) {
      setError(
        "Username must be at least 3 characters.",
      );
      return;
    }

    // ==========================================
    // AGE VALIDATION
    // ==========================================

    const numericAge = Number(age);

    if (
      !numericAge ||
      numericAge < 13 ||
      numericAge > 100
    ) {
      setError(
        "Please enter a valid age between 13 and 100.",
      );
      return;
    }

    // ==========================================
    // GENDER VALIDATION
    // ==========================================

    if (!gender) {
      setError(
        "Please select your gender.",
      );
      return;
    }

    // ==========================================
    // USER ID VALIDATION
    setSaving(true);

    try {
      // ==========================================
      // RESOLVE USER ID AND TOKEN
      // ==========================================

      let effectiveUserId = userId;
      let token =
        typeof window !== "undefined"
          ? localStorage.getItem("sc_auth_token") ||
            sessionStorage.getItem("sc_session_token") ||
            localStorage.getItem("sc_session_token")
          : null;

      if (!effectiveUserId) {
        // User just deleted their account or does not yet have a session.
        // Create an anonymous user session on demand upon profile submission.
        const sessionRes = await fetch(`${BACKEND_URL}/users/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!sessionRes.ok) {
          throw new Error("Could not initialize a new user session.");
        }
        const sessionData = await sessionRes.json();
        effectiveUserId = sessionData.userId;
        token = sessionData.token;

        if (typeof window !== "undefined" && effectiveUserId && token) {
          localStorage.setItem("sc_auth_token", token);
          localStorage.setItem("sc_auth_user_id", effectiveUserId);
          sessionStorage.setItem("sc_session_token", token);
          sessionStorage.setItem("sc_session_user_id", effectiveUserId);
        }
      }

      if (!effectiveUserId) {
        setError("User session could not be established. Please try again.");
        setSaving(false);
        return;
      }

      // ==========================================
      // SAVE BASIC PROFILE
      // ==========================================

      const response = await fetch(
        `${BACKEND_URL}/users/${effectiveUserId}/profile`,
        {
          method: "PUT",

          headers: {
            "Content-Type":
              "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },

          body: JSON.stringify({
            username:
              trimmedUsername,

            age: numericAge,

            gender,

            avatar,
          }),
        },
      );

      const data =
        await response.json();

      // ==========================================
      // BACKEND ERROR
      // ==========================================

      if (!response.ok) {
        if (
          response.status === 409 ||
          data.message
            ?.toString()
            .toLowerCase()
            .includes("username")
        ) {
          setError(
            "That username is already taken. Please choose another one.",
          );
        } else if (
          Array.isArray(data.message)
        ) {
          setError(
            data.message.join(", "),
          );
        } else {
          setError(
            data.message ||
              "Failed to save profile.",
          );
        }

        return;
      }

      console.log(
        "Basic profile saved:",
        data,
      );

      // ==========================================
      // E2EE PHASE 2: SYNC IDENTITY KEYPAIR & REGISTER PUBLIC KEY
      // ==========================================
      if (token) {
        try {
          await syncIdentityKeyLifecycle(data.publicKey, token, BACKEND_URL);
        } catch (e2eeErr) {
          console.warn("[E2EE] Identity key registration warning:", e2eeErr);
        }
      }

      // ==========================================
      // MOVE TO PREFERENCES SCREEN
      // ==========================================

      onComplete({
        userId: effectiveUserId,
        username:
          data.username,

        age:
          data.age,

        gender:
          data.gender,

        avatar:
          data.avatar,
      });
    } catch (error) {
      console.error(
        "Profile save error:",
        error,
      );

      setError(
        "Unable to connect to the backend. Make sure the NestJS server is running on port 3001.",
      );
    } finally {
      setSaving(false);
    }
  };

  // ==========================================
  // UI
  // ==========================================

  return (
    <div className="w-full max-w-md bg-zinc-900/90 backdrop-blur-md border border-zinc-800/90 rounded-3xl p-6 sm:p-8 shadow-2xl text-zinc-100 animate-fadeIn">
      {/* ====================================== */}
      {/* BRAND & HEADER */}
      {/* ====================================== */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Chi<span className="text-indigo-400">rp</span>
        </h1>
        <h2 className="text-base font-semibold text-zinc-200 mt-1">
          Create Your Profile
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Choose an avatar and handle to start chatting.
        </p>
      </div>

      {/* ====================================== */}
      {/* AVATAR SELECTOR */}
      {/* ====================================== */}
      <div className="mt-5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5 text-center">
          Choose your avatar
        </label>

        <div className="flex justify-center gap-2.5 flex-wrap">
          {avatars.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setAvatar(item)}
              disabled={saving}
              className={`w-12 h-12 rounded-2xl text-2xl flex items-center justify-center transition ${
                avatar === item
                  ? "border-2 border-indigo-500 bg-indigo-600/20 scale-110 shadow-md shadow-indigo-500/30"
                  : "border border-zinc-800 bg-zinc-950/70 hover:border-zinc-700 opacity-80 hover:opacity-100"
              } disabled:opacity-50`}
              title={`Choose ${item}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {/* ====================================== */}
      {/* USERNAME */}
      {/* ====================================== */}
      <div className="mt-5">
        <label htmlFor="profile-username" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
          Username
        </label>
        <input
          id="profile-username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="e.g. Alex_Code"
          maxLength={20}
          disabled={saving}
          className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition disabled:opacity-50"
        />
        <p className="text-[11px] text-zinc-500 mt-1">
          3–20 characters, letters and numbers
        </p>
      </div>

      {/* ====================================== */}
      {/* AGE & GENDER GRID */}
      {/* ====================================== */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label htmlFor="profile-age" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
            Age
          </label>
          <input
            id="profile-age"
            type="number"
            value={age}
            onChange={(event) => setAge(event.target.value)}
            placeholder="18"
            min={13}
            max={100}
            disabled={saving}
            className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor="profile-gender" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
            Gender
          </label>
          <select
            id="profile-gender"
            aria-label="Gender"
            value={gender}
            onChange={(event) => setGender(event.target.value)}
            disabled={saving}
            className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-3 py-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition disabled:opacity-50"
          >
            <option value="" className="bg-zinc-900 text-zinc-400">Select...</option>
            <option value="male" className="bg-zinc-900 text-white">Male</option>
            <option value="female" className="bg-zinc-900 text-white">Female</option>
            <option value="non-binary" className="bg-zinc-900 text-white">Non-binary</option>
            <option value="prefer-not-to-say" className="bg-zinc-900 text-white">Prefer not to say</option>
          </select>
        </div>
      </div>

      {/* ====================================== */}
      {/* ERROR MESSAGE */}
      {/* ====================================== */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-xl bg-red-950/60 border border-red-800/80 px-4 py-2.5 flex items-center justify-center gap-2"
        >
          <span>⚠️</span>
          <p className="text-xs text-red-300 font-medium">
            {error}
          </p>
        </div>
      )}

      {/* ====================================== */}
      {/* SUBMIT BUTTON */}
      {/* ====================================== */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving}
        className="mt-6 w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white px-6 py-3.5 rounded-xl font-bold text-sm transition shadow-lg shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] flex items-center justify-center gap-2"
      >
        {saving ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span>Creating profile...</span>
          </>
        ) : (
          <span>Enter Chirp</span>
        )}
      </button>
    </div>
  );
}