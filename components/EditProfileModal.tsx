"use client";

import { useState, useEffect } from "react";
import { CANONICAL_INTERESTS, CANONICAL_GOALS } from "@/lib/interests";
import { BACKEND_URL } from "@/lib/api-config";

export type UserProfile = {
  id: string;
  username: string | null;
  age: number | null;
  gender: string | null;
  avatar: string | null;
  language: string | null;
  interests: string[];
  goal: string | null;
};

type EditProfileModalProps = {
  isOpen: boolean;
  user: UserProfile | null;
  onClose: () => void;
  onSave: (updatedProfile: UserProfile) => void;
};

const avatars = ["🐶", "🐱", "🦊", "🐸", "🐼", "🐨", "🦁", "🐯", "🐰", "🦄"];

export default function EditProfileModal({
  isOpen,
  user,
  onClose,
  onSave,
}: EditProfileModalProps) {
  if (!isOpen || !user) return null;

  const [username, setUsername] = useState(user.username || "");
  const [age, setAge] = useState(user.age ? String(user.age) : "");
  const [gender, setGender] = useState(user.gender || "prefer-not-to-say");
  const [avatar, setAvatar] = useState(user.avatar || "🐶");
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    user.interests || []
  );
  const [language, setLanguage] = useState(user.language || "English");
  const [goal, setGoal] = useState(user.goal || "casual-chat");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("Please enter a username.");
      return;
    }
    if (trimmedUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    const numericAge = Number(age);
    if (!numericAge || numericAge < 13 || numericAge > 100) {
      setError("Please enter a valid age between 13 and 100.");
      return;
    }

    setSaving(true);

    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("sc_auth_token") ||
            sessionStorage.getItem("sc_session_token") ||
            localStorage.getItem("sc_session_token")
          : null;
      const response = await fetch(
        `${BACKEND_URL}/users/${user.id}/profile`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            username: trimmedUsername,
            age: numericAge,
            gender,
            avatar,
            interests: selectedInterests,
            language,
            goal,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 409 ||
          data.message?.toString().toLowerCase().includes("username")
        ) {
          setError("That username is already taken. Please choose another.");
        } else {
          setError(data.message || "Failed to update profile.");
        }
        return;
      }

      setSuccess(true);
      onSave({
        ...user,
        username: data.username,
        age: data.age,
        gender: data.gender,
        avatar: data.avatar,
        interests: data.interests || selectedInterests,
        language: data.language || language,
        goal: data.goal || goal,
      });

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error("Profile edit error:", err);
      setError("Could not connect to backend server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl text-zinc-100 overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h2 id="edit-profile-modal-title" className="text-lg font-bold text-white tracking-tight">
              Edit Your Profile
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit profile dialog"
            className="h-8 w-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Avatar Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Choose Avatar
            </label>
            <div className="flex flex-wrap gap-2 justify-center py-2 bg-zinc-950/60 rounded-2xl border border-zinc-800/80 p-2">
              {avatars.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setAvatar(item)}
                  className={`w-11 h-11 rounded-2xl text-2xl flex items-center justify-center transition ${
                    avatar === item
                      ? "bg-zinc-800 border-2 border-indigo-500 scale-105 shadow-md shadow-indigo-500/20"
                      : "bg-zinc-900/80 border border-zinc-800 hover:border-zinc-600 opacity-75 hover:opacity-100"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* Username */}
          <div>
            <label htmlFor="edit-profile-username" className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
              Username
            </label>
            <input
              id="edit-profile-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Alex_Code"
              maxLength={20}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
            />
          </div>

          {/* Age & Gender Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-profile-age" className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
                Age
              </label>
              <input
                id="edit-profile-age"
                type="number"
                min={13}
                max={100}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="18"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
              />
            </div>

            <div>
              <label htmlFor="edit-profile-gender" className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
                Gender
              </label>
              <select
                id="edit-profile-gender"
                aria-label="Gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-binary</option>
                <option value="prefer-not-to-say">Prefer not to say</option>
              </select>
            </div>
          </div>

          {/* Language & Goal Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-profile-language" className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
                Language
              </label>
              <select
                id="edit-profile-language"
                aria-label="Language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
              >
                <option>English</option>
                <option>Hindi</option>
                <option>Kannada</option>
                <option>Telugu</option>
                <option>Tamil</option>
                <option>Spanish</option>
              </select>
            </div>

            <div>
              <label htmlFor="edit-profile-goal" className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5">
                Goal
              </label>
              <select
                id="edit-profile-goal"
                aria-label="Goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
              >
                {CANONICAL_GOALS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Canonical Interests */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-300">
                Interests
              </label>
              {selectedInterests.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedInterests([])}
                  className="text-[11px] text-zinc-400 hover:text-white transition"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-950/60 rounded-2xl border border-zinc-800/80 max-h-36 overflow-y-auto">
              {CANONICAL_INTERESTS.map((interest) => {
                const isSelected = selectedInterests.includes(interest);
                return (
                  <button
                    key={interest}
                    type="button"
                    onClick={() =>
                      setSelectedInterests((prev) =>
                        prev.includes(interest)
                          ? prev.filter((i) => i !== interest)
                          : [...prev, interest]
                      )
                    }
                    className={`px-3 py-1 rounded-xl text-xs font-medium border transition ${
                      isSelected
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-xs shadow-indigo-600/30"
                        : "bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    #{interest}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs text-red-300 flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-xs text-emerald-300 flex items-center gap-2">
              <span>✓</span>
              <span>Profile updated successfully!</span>
            </div>
          )}

          {/* Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-indigo-600/30"
            >
              {saving ? (
                <>
                  <span className="h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
