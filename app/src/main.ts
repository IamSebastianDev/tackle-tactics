import { mount } from '@grainular/nord';
import './ui/fonts.css';
import './ui/frames.css';
import './styles.css';
import { initStorage } from './meta/storage';
import { App } from './ui/App';
import { installDesktopKeys } from './ui/desktop';
import { fitStage } from './ui/stage';

// the desktop save file is read before the first screen renders
await initStorage();
const stage = document.querySelector<HTMLElement>('#app')!;
fitStage(stage);
mount(App, { to: stage });

installDesktopKeys();
