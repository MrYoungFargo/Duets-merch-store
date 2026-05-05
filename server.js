app.get('/test-supabase', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw error;
    res.json({ success: true, users: data.users.length });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});
