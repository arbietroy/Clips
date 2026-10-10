import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import AutoEditor from "./pages/AutoEditor";
import ClipFinder from "./pages/ClipFinder";
import Home from "./pages/Home";
import ManualEditor from "./pages/ManualEditor";
import ProjectPage from "./pages/ProjectPage";
import Projects from "./pages/Projects";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="find" element={<ClipFinder />} />
          <Route path="auto" element={<AutoEditor />} />
          <Route path="editor" element={<ManualEditor />} />
          <Route path="editor/:id" element={<ManualEditor />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
