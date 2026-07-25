const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// Only configure Google OAuth if credentials are provided
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Default to the LIVE backend. Override with GOOGLE_CALLBACK_URL
        // (e.g. http://localhost:3001/api/auth/google/callback for local dev).
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'https://api.touchstones.ai/api/auth/google/callback',
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Here you would typically:
          // 1. Check if user exists in your database
          // 2. If not, create a new user
          // 3. Return the user object

          const user = {
            id: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            // Add any other fields you want to store
          };

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
} else {
  console.warn('Google OAuth not configured - GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing');
}

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

module.exports = passport;
