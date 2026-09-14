"use client";

import { useState } from "react";

type ProfileSetupProps = {
  userId: string;
  onComplete: (profile: {
    username: string;
    age: number;
    gender: string;
    avatar: string;
  }) => void;
};

const avatars = ["🐶", "🐱", "🦊", "🐸", "🐼", "🐨"];

export default function ProfileSetup({
  userId,
  onComplete,
}: ProfileSetupProps) {
  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [avatar, setAvatar] = useState("🐶");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");

    const trimmedUsername = username.trim();

    // Username validation
    if (!trimmedUsername) {
      setError("Please enter a username.");
      return;
    }

    if (trimmedUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    // Age validation
    const numericAge = Number(age);

    if (!numericAge || numericAge < 13 || numericAge > 100) {
      setError("Please enter a valid age between 13 and 100.");
      return;
    }

    // Gender validation
    if (!gender) {
      setError("Please select your gender.");
      return;
    }

    // User ID validation
    if (!userId) {
      setError("User session not found. Please refresh the page.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        `http://localhost:3001/users/${userId}/profile`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: trimmedUsername,
            age: numericAge,
            gender,
            avatar,
          }),
        },
      );

      const data = await response.json();

      // Backend error
      if (!response.ok) {
        if (
          response.status === 409 ||
          data.message?.toString().toLowerCase().includes("username")
        ) {
          setError(
            "That username is already taken. Please choose another one.",
          );
        } else if (Array.isArray(data.message)) {
          setError(data.message.join(", "));
        } else {
          setError(data.message || "Failed to save profile.");
        }

        return;
      }

      console.log("Profile saved successfully:", data);

      // Tell page.tsx that profile setup is complete
      onComplete({
        username: data.username,
        age: data.age,
        gender: data.gender,
        avatar: data.avatar,
      });
    } catch (error) {
      console.error("Profile save error:", error);

      setError(
        "Unable to connect to the backend. Make sure the NestJS server is running on port 3001.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-xl">
      {/* HEADER */}

      <h1 className="text-2xl font-bold text-zinc-900 text-center">
        Create Your Profile
      </h1>

      <p className="text-zinc-500 mt-2 text-center">
        Tell us a little about yourself.
      </p>

      {/* USERNAME */}

      <div className="mt-6">
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Username
        </label>

        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Enter your username"
          maxLength={20}
          disabled={saving}
          className="w-full border border-zinc-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-100"
        />

        <p className="text-xs text-zinc-400 mt-1">
          3–20 characters
        </p>
      </div>

      {/* AGE */}

      <div className="mt-5">
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Age
        </label>

        <input
          type="number"
          value={age}
          onChange={(event) => setAge(event.target.value)}
          placeholder="Enter your age"
          min={13}
          max={100}
          disabled={saving}
          className="w-full border border-zinc-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-100"
        />
      </div>

      {/* GENDER */}

      <div className="mt-5">
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Gender
        </label>

        <select
          value={gender}
          onChange={(event) => setGender(event.target.value)}
          disabled={saving}
          className="w-full border border-zinc-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-100"
        >
          <option value="">Select gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="non-binary">Non-binary</option>
          <option value="prefer-not-to-say">
            Prefer not to say
          </option>
        </select>
      </div>

      {/* AVATAR */}

      <div className="mt-6">
        <label className="block text-sm font-medium text-zinc-700 mb-3">
          Choose your avatar
        </label>

        <div className="flex justify-center gap-3 flex-wrap">
          {avatars.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setAvatar(item)}
              disabled={saving}
              className={`w-14 h-14 rounded-full text-3xl border-2 transition ${
                avatar === item
                  ? "border-zinc-900 bg-zinc-100 scale-110"
                  : "border-zinc-200 hover:border-zinc-400"
              } disabled:opacity-50`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {/* ERROR */}

      {error && (
        <div className="mt-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-600 text-center">
            {error}
          </p>
        </div>
      )}

      {/* CONTINUE */}

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="mt-7 w-full bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving profile..." : "Continue"}
      </button>
    </div>
  );
}