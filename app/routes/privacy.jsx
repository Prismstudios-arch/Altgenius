// Public privacy policy, served at /privacy (no auth). Required for App Store
// submission. Update SUPPORT_EMAIL before you submit.
const SUPPORT_EMAIL = "jonnywilsonnn2012@gmail.com";
const EFFECTIVE_DATE = "June 28, 2026";

export const meta = () => [{ title: "AltGenius AI — Privacy Policy" }];

export default function Privacy() {
  const heading = { marginTop: "1.6em", marginBottom: "0.4em", fontSize: "1.2rem" };
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px 80px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        lineHeight: 1.6,
        color: "#202223",
      }}
    >
      <h1 style={{ fontSize: "1.8rem", marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: "#6d7175", marginTop: 0 }}>
        AltGenius AI · Last updated {EFFECTIVE_DATE}
      </p>

      <p>
        AltGenius AI (&quot;AltGenius&quot;, &quot;we&quot;, &quot;us&quot;) is a
        Shopify app that generates SEO-optimized alt text for product images. This
        policy explains what data we access, how we use it, and your rights.
      </p>

      <h2 style={heading}>Information we access</h2>
      <ul>
        <li>
          <strong>Product data</strong> — product titles and product image URLs,
          read through the Shopify Admin API, so we can analyze images and write
          alt text back to your store. We request only the{" "}
          <code>read_products</code>, <code>write_products</code>, and{" "}
          <code>write_files</code> scopes.
        </li>
        <li>
          <strong>Store &amp; session data</strong> — your store domain and an
          access token, stored only so the app stays connected to your store.
        </li>
        <li>
          We do <strong>not</strong> access or store customer data, orders, or
          payment information.
        </li>
      </ul>

      <h2 style={heading}>How we use it</h2>
      <p>
        When you click &quot;Generate Alt Text&quot;, the selected product image
        is sent to Google&apos;s Gemini API to produce a description, which is then
        saved as the image&apos;s alt text in your store. Images are processed in
        real time and are not retained by AltGenius after processing.
      </p>

      <h2 style={heading}>Third-party services</h2>
      <ul>
        <li>
          <strong>Google Gemini API</strong> — analyzes product images to generate
          alt text. See Google&apos;s privacy policy.
        </li>
        <li>
          <strong>Shopify</strong> — the platform your store and our app run on.
        </li>
        <li>
          <strong>Fly.io</strong> — hosts the application.
        </li>
      </ul>

      <h2 style={heading}>Data retention</h2>
      <p>
        We store your store&apos;s session record so the app functions. When you
        uninstall AltGenius, this data is deleted. We honor Shopify&apos;s mandatory
        data-request and data-erasure (redact) webhooks for shops and customers.
      </p>

      <h2 style={heading}>Your rights</h2>
      <p>
        You can request access to, or deletion of, any data we hold by contacting
        us. Uninstalling the app removes our access and deletes your stored session
        data.
      </p>

      <h2 style={heading}>Changes</h2>
      <p>
        We may update this policy from time to time. Material changes will be
        reflected here with a new &quot;last updated&quot; date.
      </p>

      <h2 style={heading}>Contact</h2>
      <p>
        Questions about this policy or your data? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </main>
  );
}
