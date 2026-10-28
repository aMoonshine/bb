import { hydrateRoot } from "react-dom/client";
import { SiteFooter, SiteNav } from "./site-chrome";

const nav = document.getElementById("site-nav");
const footer = document.getElementById("site-footer");
if (nav) hydrateRoot(nav, <SiteNav />);
if (footer) hydrateRoot(footer, <SiteFooter />);
