import { mount } from '@grainular/nord';
import './ui/fonts.css';
import './ui/frames.css';
import './styles.css';
import { initStorage } from './meta/storage';
import { loadCastPack } from './ui/castPack';
import { App } from './ui/App';
import { installDesktopKeys } from './ui/desktop';
import { installRadioKeys } from './ui/RadioUI';
import { fitStage } from './ui/stage';

// the save and the sprite pack are read before the first screen renders
await Promise.all([initStorage(), loadCastPack()]);
const stage = document.querySelector<HTMLElement>('#app')!;
fitStage(stage);
mount(App, { to: stage });

installDesktopKeys();
installRadioKeys();
