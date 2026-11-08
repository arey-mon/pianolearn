'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Player from './components/Player';
import { loadScoreFile, type Score } from '@/lib/score';
import {
  addToLibrary,
  listLibrary,
  openFromLibrary,
  removeFromLibrary,
  type LibraryItem,
} from '@/lib/library';

export default function Home() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LibraryItem | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listLibrary());
    } catch {
      setError('Bibliothèque inaccessible sur ce navigateur');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Import d'un ou plusieurs fichiers : ajout à la bibliothèque, ouverture directe si un seul
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    setError(null);

    const failed: string[] = [];
    let lastScore: Score | null = null;
    for (const file of files) {
      try {
        const s = await loadScoreFile(file);
        await addToLibrary(file, s.title, s.notes.length);
        lastScore = s;
      } catch {
        failed.push(file.name);
      }
    }
    await refresh();
    if (failed.length) setError(`Import impossible : ${failed.join(', ')}`);
    if (files.length === 1 && lastScore) setScore(lastScore);
  };

  const open = async (item: LibraryItem) => {
    setError(null);
    try {
      const file = await openFromLibrary(item.id);
      if (!file) throw new Error('Partition introuvable');
      setScore(await loadScoreFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de lecture');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    await removeFromLibrary(toDelete.id);
    setToDelete(null);
    await refresh();
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          {score && (
            <IconButton edge="start" onClick={() => setScore(null)} aria-label="Retour à la bibliothèque">
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography variant="subtitle1" noWrap sx={{ flex: 1, fontWeight: 600 }}>
            {score?.title ?? 'Ma bibliothèque'}
          </Typography>
          {!score && (
            <Button component="label" variant="outlined" size="small" startIcon={<UploadFileIcon />}>
              Importer
              <input type="file" hidden multiple onChange={onFiles} />
            </Button>
          )}
        </Toolbar>
      </AppBar>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mb: 1 }}>
          {error}
        </Alert>
      )}

      {score ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <Player key={`${score.title}-${score.notes.length}`} score={score} />
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {items.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
              <LibraryMusicIcon sx={{ fontSize: 48, mb: 1 }} />
              <Typography>Aucune partition pour l’instant.</Typography>
              <Typography variant="body2">
                Importe un ou plusieurs fichiers MusicXML (.mxl, .musicxml) ou MIDI.
              </Typography>
            </Box>
          ) : (
            <List>
              {items.map((item) => (
                <ListItem
                  key={item.id}
                  disablePadding
                  secondaryAction={
                    <IconButton
                      edge="end"
                      aria-label={`Supprimer ${item.title}`}
                      onClick={() => setToDelete(item)}
                    >
                      <DeleteOutlineIcon />
                    </IconButton>
                  }
                >
                  <ListItemButton onClick={() => open(item)}>
                    <ListItemText
                      primary={item.title}
                      secondary={`${item.noteCount} notes · ajoutée le ${new Date(item.addedAt).toLocaleDateString('fr-FR')}`}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      )}

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)}>
        <DialogTitle>Supprimer « {toDelete?.title} » ?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Annuler</Button>
          <Button color="error" onClick={confirmDelete}>
            Supprimer
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}