// Browser entry: registers each Alpine component (one per file) and starts Alpine.
import Alpine from '/assets/vendor/alpine.esm.js';
import Modal from './components/modal.js';
import SpaceBoard from './board/board.js';
import ThemeToggle from './components/theme-toggle.js';

Alpine.data('Modal', Modal);
Alpine.data('ThemeToggle', ThemeToggle);
Alpine.data('SpaceBoard', SpaceBoard);

window.Alpine = Alpine;
Alpine.start();
