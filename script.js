// Supabase setup
const SUPABASE_URL = "https://fucddnhmxhskmzmhmzyw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1Y2RkbmhteGhza216bWhtenl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NzcyMjUsImV4cCI6MjA3OTA1MzIyNX0.TvLGcHwQGNWxfBb54A3Z-3s9bFEHiLPBBHPzqOuoqeo";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Message Function
function showMessage(text, type = "error") {
  const msg = document.getElementById("message");
  if (!msg) return;
  msg.textContent = text;
  msg.className = "message " + type;
  msg.style.display = "block";
}

// Helper: Get login attempts
async function getAttempts(email) {
  const { data, error } = await supabase
    .from("login_attempts")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("Error fetching attempts:", error);
    return null;
  }
  return data;
}

// Helper: Save failed login
async function registerFail(email) {
  const user = await getAttempts(email);
  const now = new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' });

  let attempts = 1;
  let lockUntil = null;
  let lockMinutes = null;

  if (user) {
    attempts = user.attempts + 1;

    if (attempts >= 3) {
      const nowMs = Date.now();
      const baseDuration = 5 * 60 * 1000;
      const multiplier = Math.pow(2, attempts - 3);
      const ban = baseDuration * multiplier;
      lockMinutes = 5 * multiplier;
      lockUntil = nowMs + ban;
    }
  }

  await supabase.from("login_attempts").upsert({
    email,
    attempts,
    lock_until: lockUntil,
    lock_minutes: lockMinutes,
    last_attempt_time: now
  });
}

// Helper: Reset attempts on success
async function resetAttempts(email) {
  await supabase.from("login_attempts")
    .delete()
    .eq("email", email);
}

// Helper: Record Successful Login  
async function recordSuccessLogin(email) {
  const saudi = new Date().toLocaleString('en-SA', {
    timeZone: 'Asia/Riyadh'
  });

  const { error } = await supabase
    .from("login_success_log")
    .insert({
      email: email,
      login_time: saudi
    });

  if (error) console.error("Error saving login success:", error);
}

// Login Function
async function loginUser() {
  const email = document.getElementById("Email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    showMessage("Please enter both email and password");
    return;
  }

  const user = await getAttempts(email);

  if (user && user.lock_until && Date.now() < user.lock_until) {
    const remaining = Math.ceil((user.lock_until - Date.now()) / 60000);
    showMessage(`Too many attempts. Try again after ${remaining} minutes.`);
    return;
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      await registerFail(email);
      showMessage("Invalid email or password");
      return;
    }

    if (data.user) {
      await resetAttempts(email);

      await recordSuccessLogin(email);

      showMessage("Login successful! Redirecting...", "success");

      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 1500);
    }

  } catch (err) {
    console.error(err);
    showMessage("Network error. Please try again.");
  }
}

// Event Listeners
document.addEventListener("DOMContentLoaded", function () {
  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn) loginBtn.addEventListener("click", loginUser);

  document.getElementById("Email").addEventListener("keypress", e => {
    if (e.key === "Enter") loginUser();
  });

  document.getElementById("password").addEventListener("keypress", e => {
    if (e.key === "Enter") loginUser();
  });
});
