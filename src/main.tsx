import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Route, Switch } from "wouter";
import { queryClient } from "./api";
import { Catalog } from "./pages/Catalog";
import { Home } from "./pages/Home";
import { InviteLink } from "./pages/InviteLink";
import { Login } from "./pages/Login";
import { Review } from "./pages/Review";
import { Versions } from "./pages/Versions";
import { decodeShare } from "./share";
import { useStore } from "./store";
import { RequireAuth } from "./ui/AppHeader";
import "./index.css";

const Playground = lazy(() => import("./Playground"));
const SchemaEditor = lazy(() => import("./pages/SchemaEditor"));
const ExampleEditor = lazy(() => import("./pages/ExampleEditor"));

// Share links from before the rename point at the root; they belong to the playground now.
const shared = location.hash.startsWith("#s=") && decodeShare(location.hash.slice(3));
if (shared) {
  useStore.getState().load(shared);
  history.replaceState(null, "", "/playground");
}

const loading = <p className="p-6 text-muted">Loading…</p>;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={loading}>
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/playground" component={Playground} />
          <Route path="/invite/:token">{(p) => <InviteLink token={p.token} />}</Route>
          <RequireAuth>
            <Switch>
              <Route path="/">
                <Home />
              </Route>
              <Route path="/new/paste">
                <Home paste />
              </Route>
              <Route path="/catalog" component={Catalog} />
              <Route path="/schemas/:id/versions">{(p) => <Versions id={Number(p.id)} />}</Route>
              <Route path="/schemas/:id/suggestions/:n">
                {(p) => <Review id={Number(p.id)} number={Number(p.n)} />}
              </Route>
              <Route path="/schemas/:id/examples/:exampleId">
                {(p) => <ExampleEditor id={Number(p.id)} exampleId={Number(p.exampleId)} />}
              </Route>
              <Route path="/schemas/:id/share">
                {(p) => <SchemaEditor id={Number(p.id)} share />}
              </Route>
              <Route path="/schemas/:id">{(p) => <SchemaEditor id={Number(p.id)} />}</Route>
              <Route>
                <p className="p-6">
                  Page not found. <a href="/">Back to my schemas</a>
                </p>
              </Route>
            </Switch>
          </RequireAuth>
        </Switch>
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
