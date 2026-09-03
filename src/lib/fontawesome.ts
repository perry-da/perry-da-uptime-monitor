import { config } from "@fortawesome/fontawesome-svg-core";

// We import the stylesheet ourselves in layout.tsx, so disable the library's
// own runtime <style> injection to avoid a flash of unstyled icons under SSR.
config.autoAddCss = false;
