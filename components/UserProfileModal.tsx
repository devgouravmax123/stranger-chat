"use client";

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

  const goalLabels: Record<string, string> = {
    "casual-chat": "Casual Chat",
    friendship: "Friendship",
    learning: "Learning",
    networking: "Networking",
  };

  const genderLabels: Record<string, string> = {
    male: "Male",
    female: "Female",
    "non-binary": "Non-binary",
    "prefer-not-to-say": "Prefer not to say",
  };

  const displayGoal = user.goal
    ? goalLabels[user.goal] || user.goal
    : "Not specified";

  const displayGender = user.gender
    ? genderLabels[user.gender] || user.gender
    : "Not specified";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* HEADER */}

        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900">
            Profile
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-lg text-zinc-600 hover:bg-zinc-200"
            aria-label="Close profile"
          >
            ×
          </button>
        </div>

        {/* PROFILE CONTENT */}

        <div className="px-6 py-6">

          {/* AVATAR */}

          <div className="flex justify-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-zinc-100 bg-zinc-50 text-6xl">
              {user.avatar || "👤"}
            </div>
          </div>

          {/* USERNAME */}

          <div className="mt-4 text-center">
            <h3 className="text-2xl font-bold text-zinc-900">
              {user.username || "Anonymous"}
            </h3>
          </div>

          {/* DETAILS */}

          <div className="mt-6 space-y-3">

            {/* AGE */}

            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
              <span className="text-sm text-zinc-500">
                Age
              </span>

              <span className="text-sm font-medium text-zinc-900">
                {user.age ?? "Not specified"}
              </span>
            </div>

            {/* GENDER */}

            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
              <span className="text-sm text-zinc-500">
                Gender
              </span>

              <span className="text-sm font-medium text-zinc-900">
                {displayGender}
              </span>
            </div>

            {/* LANGUAGE */}

            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
              <span className="text-sm text-zinc-500">
                Language
              </span>

              <span className="text-sm font-medium text-zinc-900">
                {user.language || "Not specified"}
              </span>
            </div>

            {/* LOOKING FOR */}

            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
              <span className="text-sm text-zinc-500">
                Looking for
              </span>

              <span className="text-sm font-medium text-zinc-900">
                {displayGoal}
              </span>
            </div>

          </div>

          {/* INTERESTS */}

          <div className="mt-5">

            <p className="mb-2 text-sm font-medium text-zinc-500">
              Interests
            </p>

            {user.interests &&
            user.interests.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {user.interests.map(
                  (interest) => (
                    <span
                      key={interest}
                      className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      {interest}
                    </span>
                  ),
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                No interests added
              </p>
            )}

          </div>

        </div>

        {/* FOOTER */}

        <div className="border-t px-6 py-4">

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Close
          </button>

        </div>

      </div>
    </div>
  );
}