/**
 * Inline pre-paint script: applies persisted theme/accent/density to <html>
 * before the first paint, so users don't see a FOUC switching from light → dark.
 */
export function ThemeBootScript() {
  const code = `(function(){try{
    var t=localStorage.getItem('pr_theme')||'dark';
    var a=localStorage.getItem('pr_accent')||'indigo';
    var d=localStorage.getItem('pr_density')||'compact';
    var h=document.documentElement;
    h.setAttribute('data-theme',t);
    h.setAttribute('data-accent',a);
    h.setAttribute('data-density',d);
  }catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
