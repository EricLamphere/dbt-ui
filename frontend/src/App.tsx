import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Home from './routes/Home';
import ProjectHome from './routes/Project/index';
import ProjectLayout from './routes/Project/ProjectLayout';
import ModelsPage from './routes/Project/Models';
import InitScriptsPage from './routes/Project/InitScripts';
import FileExplorerPage from './routes/Project/FileExplorer';
import EnvironmentPage from './routes/Project/Environment';
import DocsPage from './routes/Project/Docs';
import GitPage from './routes/Project/Git';
import WorkspacePage from './routes/Project/Workspace';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen overflow-hidden">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectHome />} />
              <Route path="models" element={<ModelsPage />} />
              <Route path="init" element={<InitScriptsPage />} />
              <Route path="files" element={<FileExplorerPage />} />
              <Route path="environment" element={<EnvironmentPage />} />
              <Route path="docs" element={<DocsPage />} />
              <Route path="git" element={<GitPage />} />
              <Route path="workspace" element={<WorkspacePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
