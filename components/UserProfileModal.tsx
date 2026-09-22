"use client";
import { formatGoal } from "@/lib/interests";

type UserProfile = {
  id: string;
  username: string | null;
  age: number | null;
  gender: string | null;
  avatar: string | null;
  language: string | null;
  interests: string[];
  goal: string | null;
};

type UserProfileModalProps = {
  user: UserProfile | null;
  onClose: () => void;
};

export default function UserProfileModal({
  user,
  onClose,
}: UserProfileModalProps) {
  if (!user) {
    return null;
  }

  const genderLabels: Record<string, string> = {
    male: "Male",
    female: "Female",
    "non-binary": "Non-binary",
    "prefer-not-to-say": "Prefer not to say",
  };

  const displayGoal = user.goal ? formatGoal(user.goal) : "Not specified";

  const displayGender = user.gender
    ? genderLabels[user.gender] || user.gender
    : "Not specified";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-profile-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl text-zinc-100"
        onClick={(event) => event.stopPropagation()}
      >
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 sm:px-6 py-4 shrink-0">
          <h2 id="user-profile-modal-title" className="text-lg font-semibold text-white">
            Profile
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-base text-zinc-400 hover:bg-zinc-700 hover:text-white"
            aria-label="Close profile"
          >
            ✕
          </button>
        </div>

        {/* PROFILE CONTENT */}
        <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1">
          {/* AVATAR */}
          <div className="flex justify-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-zinc-800 bg-zinc-800/60 text-5xl shadow-inner">
              {user.avatar || "👤"}
            </div>
          </div>

          {/* USERNAME */}
          <div className="mt-4 text-center">
            <h3 className="text-xl font-bold text-white">
              {user.username || "Anonymous"}
            </h3>
          </div>

          {/* DETAILS */}
          <div className="mt-6 space-y-2.5">
            {/* AGE */}
            <div className="flex items-center justify-between rounded-xl bg-zinc-950/70 border border-zinc-800/80 px-4 py-2.5">
              <span className="text-xs font-medium text-zinc-400">
                Age
              </span>
              <span className="text-sm font-semibold text-zinc-200">
                {user.age ?? "Not specified"}
              </span>
            </div>

            {/* GENDER */}
            <div className="flex items-center justify-between rounded-xl bg-zinc-950/70 border border-zinc-800/80 px-4 py-2.5">
              <span className="text-xs font-medium text-zinc-400">
                Gender
              </span>
              <span className="text-sm font-semibold text-zinc-200">
                {displayGender}
              </span>
            </div>

            {/* LANGUAGE */}
            <div className="flex items-center justify-between rounded-xl bg-zinc-950/70 border border-zinc-800/80 px-4 py-2.5">
              <span className="text-xs font-medium text-zinc-400">
                Language
              </span>
              <span className="text-sm font-semibold text-zinc-200">
                {user.language || "Not specified"}
              </span>
            </div>

            {/* LOOKING FOR */}
            <div className="flex items-center justify-between rounded-xl bg-zinc-950/70 border border-zinc-800/80 px-4 py-2.5">
              <span className="text-xs font-medium text-zinc-400">
                Looking for
              </span>
              <span className="text-sm font-semibold text-indigo-400">
                {displayGoal}
              </span>
            </div>
          </div>

          {/* INTERESTS */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Interests
            </p>

            {user.interests && user.interests.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {user.interests.map((interest) => (
                  <span
                    key={interest}
                    className="rounded-full bg-zinc-800 border border-zinc-700/60 px-3 py-1 text-xs font-medium text-zinc-200"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                No interests added
              </p>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t border-zinc-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}